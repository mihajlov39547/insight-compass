import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, RefreshCw, Stethoscope, AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  usePlantDiagnoses,
  useDiagnoseDisease,
  useConfirmPlantDiagnosis,
  type PlantDiagnosis,
  type PlantDiseaseReview,
  type PlantDiseaseReviewItem,
  type PlantDiseaseRelatedImage,
} from '@/hooks/usePlantDiagnoses';
import { prepareWebpTempImages } from '@/hooks/usePlantIdentifications';
import type { PlantCaseImage } from '@/hooks/usePlantCaseImages';
import { useAuth } from '@/contexts/useAuth';
import { isConvertibleForIdentification, isWebpMime } from '@/lib/plantImageConversion';
import { usePlantAdvisorSettings, toPlantnetApiLang } from '@/hooks/usePlantAdvisorSettings';

interface Props {
  caseId: string;
  images: PlantCaseImage[];
  hasConfirmedIdentification: boolean;
}

function fmtPct(s: number | null | undefined): string {
  if (s == null) return '—';
  return `${Math.round(s * 100)}%`;
}

function errorKey(code: string | undefined): string {
  switch (code) {
    case 'api_key_missing':
      return 'plantAdvisor.diagnose.errors.apiKeyMissing';
    case 'no_compatible_images':
      return 'plantAdvisor.diagnose.errors.noCompatible';
    case 'image_download_failed':
      return 'plantAdvisor.diagnose.errors.downloadFailed';
    case 'quota_exhausted':
      return 'plantAdvisor.diagnose.errors.quotaExhausted';
    case 'auth_failed':
      return 'plantAdvisor.diagnose.errors.authFailed';
    case 'bad_request':
      return 'plantAdvisor.diagnose.errors.badRequest';
    case 'empty_results':
      return 'plantAdvisor.diagnose.errors.empty';
    case 'plant_not_confirmed':
      return 'plantAdvisor.diagnose.errors.plantNotConfirmed';
    default:
      return 'plantAdvisor.diagnose.errors.generic';
  }
}

function pickImgUrl(img: PlantDiseaseRelatedImage): string | null {
  return img.urlMedium || img.urlSmall || img.urlOriginal || null;
}

function ImageStrip({
  images,
  onOpen,
}: {
  images: PlantDiseaseRelatedImage[];
  onOpen: (img: PlantDiseaseRelatedImage) => void;
}) {
  const { t } = useTranslation();
  if (!images || images.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto py-1">
      {images.map((img, i) => {
        const src = pickImgUrl(img);
        if (!src) return null;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onOpen(img)}
            className="relative flex-shrink-0 h-16 w-16 rounded-md overflow-hidden border border-border bg-muted hover:ring-2 hover:ring-primary/50 transition"
            aria-label={t('plantAdvisor.diagnose.openImage')}
          >
            <img
              src={src}
              alt={img.organ || ''}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            {img.organ && (
              <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 truncate">
                {img.organ}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function PlantDiseaseDiagnosisSection({ caseId, images, hasConfirmedIdentification }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: diagnoses = [], isLoading } = usePlantDiagnoses(caseId);
  const diagnose = useDiagnoseDisease();
  const confirmMut = useConfirmPlantDiagnosis();
  const settings = usePlantAdvisorSettings();

  const [preparing, setPreparing] = useState(false);
  const [review, setReview] = useState<PlantDiseaseReview | null>(null);
  const [openImg, setOpenImg] = useState<PlantDiseaseRelatedImage | null>(null);

  const identifiable = images.filter((i) => isConvertibleForIdentification(i.mime_type));
  const webps = images.filter((i) => isWebpMime(i.mime_type));
  const hasImages = images.length > 0;
  const hasIdentifiable = identifiable.length > 0;
  const hasWebp = webps.length > 0;

  const run = async () => {
    try {
      let tempImages: Awaited<ReturnType<typeof prepareWebpTempImages>> = [];
      if (hasWebp && user?.id) {
        setPreparing(true);
        try {
          tempImages = await prepareWebpTempImages({ userId: user.id, caseId, images: webps });
        } catch (err) {
          console.warn('[plant-disease] webp conversion failed', err);
          toast.error(t('plantAdvisor.diagnose.errors.webpConvertFailed'));
          return;
        } finally {
          setPreparing(false);
        }
      }
      const res = await diagnose.mutateAsync({
        plantCaseId: caseId,
        tempImages: tempImages.length > 0 ? tempImages : undefined,
        lang: toPlantnetApiLang(settings.identificationLanguage),
      });
      if (res.error) {
        toast.error(t(errorKey(res.error)));
      } else {
        setReview(res.review ?? null);
        toast.success(t('plantAdvisor.diagnose.doneToast'));
      }
    } catch (e: any) {
      toast.error(t(errorKey(e?.code)));
    }
  };

  const doConfirm = async (diagnosisId: string) => {
    try {
      await confirmMut.mutateAsync({ plantCaseId: caseId, diagnosisId });
      toast.success(t('plantAdvisor.diagnose.confirmedToast'));
    } catch {
      toast.error(t('plantAdvisor.diagnose.errors.confirmFailed'));
    }
  };

  const confirmed = diagnoses.find((d) => d.is_confirmed) || null;
  const top: PlantDiagnosis | undefined = confirmed || diagnoses[0];
  const alts = diagnoses.filter((d) => d.id !== top?.id).slice(0, 5);

  const reviewByRank = new Map<number, PlantDiseaseReviewItem>();
  if (review) {
    for (const d of review.diseases) reviewByRank.set(d.rank, d);
  }

  const problemTypeLabel = (pt: string | null | undefined): string => {
    if (pt === 'pest') return t('plantAdvisor.diagnose.problemType.pest');
    if (pt === 'disease') return t('plantAdvisor.diagnose.problemType.disease');
    return t('plantAdvisor.diagnose.problemType.unknown');
  };
  const confidenceLabel = (bucket: string): string => {
    if (bucket === 'high') return t('plantAdvisor.diagnose.confidenceBucket.high');
    if (bucket === 'medium') return t('plantAdvisor.diagnose.confidenceBucket.medium');
    return t('plantAdvisor.diagnose.confidenceBucket.low');
  };
  const bucketOf = (s: number | null): 'high' | 'medium' | 'low' => {
    if (typeof s !== 'number') return 'low';
    if (s >= 0.7) return 'high';
    if (s >= 0.4) return 'medium';
    return 'low';
  };
  const problemTypeOf = (d: PlantDiagnosis): string =>
    reviewByRank.get(d.rank)?.problemType ?? d.problem_type ?? 'unknown';
  const providerCodeOf = (d: PlantDiagnosis): string | null =>
    reviewByRank.get(d.rank)?.providerCode ?? null;

  const topBucket = top ? bucketOf(top.score) : 'low';
  const showLowConfidenceWarning = !!top && top.score !== null && top.score < 0.4;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <Stethoscope className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{t('plantAdvisor.diagnose.sectionTitle')}</div>
          <div className="text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">{t('plantAdvisor.identify.providerBadge')}</Badge>
          </div>
        </div>
        <Button
          size="sm"
          onClick={run}
          disabled={!hasImages || !hasIdentifiable || diagnose.isPending || preparing}
        >
          {preparing ? (
            <>
              <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
              {t('plantAdvisor.identify.preparing')}
            </>
          ) : diagnose.isPending ? (
            <>
              <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
              {t('plantAdvisor.diagnose.running')}
            </>
          ) : diagnoses.length > 0 ? (
            <>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              {t('plantAdvisor.diagnose.runAgain')}
            </>
          ) : (
            <>
              <Stethoscope className="h-4 w-4 mr-1.5" />
              {t('plantAdvisor.diagnose.diagnose')}
            </>
          )}
        </Button>
      </div>

      {!hasImages && (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.diagnose.uploadFirst')}</div>
      )}
      {hasImages && !hasConfirmedIdentification && (
        <div className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-1.5 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{t('plantAdvisor.diagnose.plantNotConfirmedHint')}</span>
        </div>
      )}

      {isLoading && (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.diagnose.loading')}</div>
      )}

      {showLowConfidenceWarning && (
        <div className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-1.5 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{t('plantAdvisor.diagnose.lowConfidenceWarning')}</span>
        </div>
      )}

      {top && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <div className="font-medium truncate">{top.name || '—'}</div>
              {providerCodeOf(top) && providerCodeOf(top) !== top.name && (
                <div className="text-[10px] text-muted-foreground">
                  {t('plantAdvisor.diagnose.providerCode')}: {providerCodeOf(top)}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {top.is_confirmed && (
                <Badge variant="default" className="text-[10px]">
                  <Check className="h-3 w-3 mr-1" />
                  {t('plantAdvisor.diagnose.confirmedDiagnosis')}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {problemTypeLabel(problemTypeOf(top))}
              </Badge>
              <Badge
                variant={topBucket === 'low' ? 'destructive' : 'secondary'}
                className="text-[10px]"
              >
                {confidenceLabel(topBucket)} · {fmtPct(top.score)}
              </Badge>
            </div>
          </div>
          {top.description && top.description !== top.name && (
            <div className="text-xs text-muted-foreground whitespace-pre-wrap">{top.description}</div>
          )}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <Field
              label={t('plantAdvisor.diagnose.affectedOrgans')}
              value={(top.affected_organs || []).join(', ') || '—'}
            />
            <Field label={t('plantAdvisor.diagnose.provider')} value={top.provider} />
          </div>
          <div className="text-[10px] text-muted-foreground">
            {t('plantAdvisor.diagnose.languageUsed')}:{' '}
            {top.language === 'hr' ? t('plantAdvisor.settings.lang.sr') : t('plantAdvisor.settings.lang.en')}
          </div>
          {(reviewByRank.get(top.rank)?.relatedImages?.length ?? 0) > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                {t('plantAdvisor.diagnose.referenceImages')}
              </div>
              <ImageStrip images={reviewByRank.get(top.rank)!.relatedImages} onOpen={setOpenImg} />
            </div>
          )}
          <div className="text-[10px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
            <Info className="h-3 w-3" />
            {t('plantAdvisor.diagnose.notTreatmentAdvice')}
          </div>
          {!top.is_confirmed && (
            <Button size="sm" variant="outline" onClick={() => doConfirm(top.id)} disabled={confirmMut.isPending}>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              {t('plantAdvisor.diagnose.confirmThis')}
            </Button>
          )}
          <div>
            <Button size="sm" variant="ghost" disabled className="text-[11px]">
              {t('plantAdvisor.diagnose.treatmentComingNext')}
            </Button>
          </div>
        </div>
      )}

      {alts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            {t('plantAdvisor.identify.alternatives')}
          </div>
          <ul className="space-y-2">
            {alts.map((a) => {
              const relImgs = reviewByRank.get(a.rank)?.relatedImages ?? [];
              const aCode = providerCodeOf(a);
              const aBucket = bucketOf(a.score);
              return (
                <li key={a.id} className="rounded-md border border-border/60 px-2 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium text-xs truncate">{a.name || '—'}</div>
                      {aCode && aCode !== a.name && (
                        <div className="text-[10px] text-muted-foreground">
                          {t('plantAdvisor.diagnose.providerCode')}: {aCode}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {problemTypeLabel(problemTypeOf(a))}
                      </Badge>
                      <Badge
                        variant={aBucket === 'low' ? 'destructive' : 'secondary'}
                        className="text-[10px]"
                      >
                        {fmtPct(a.score)}
                      </Badge>
                      {a.is_confirmed ? (
                        <Badge variant="default" className="text-[10px]">
                          <Check className="h-3 w-3 mr-1" />
                          {t('plantAdvisor.diagnose.confirmedDiagnosis')}
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => doConfirm(a.id)}
                          disabled={confirmMut.isPending}
                        >
                          {t('plantAdvisor.diagnose.useThis')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {a.description && a.description !== a.name && (
                    <div className="text-[11px] text-muted-foreground line-clamp-3">{a.description}</div>
                  )}
                  {relImgs.length > 0 && <ImageStrip images={relImgs} onOpen={setOpenImg} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Dialog open={!!openImg} onOpenChange={(o) => !o && setOpenImg(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('plantAdvisor.diagnose.imageAttribution')}</DialogTitle>
          </DialogHeader>
          {openImg && (
            <div className="space-y-3">
              <img
                src={openImg.urlOriginal || openImg.urlMedium || openImg.urlSmall || ''}
                alt={openImg.organ || ''}
                className="w-full max-h-[60vh] object-contain rounded-md bg-muted"
              />
              <div className="text-xs space-y-1">
                {openImg.organ && <div><span className="text-muted-foreground">{t('plantAdvisor.identify.organ')}:</span> {openImg.organ}</div>}
                {openImg.author && <div><span className="text-muted-foreground">{t('plantAdvisor.identify.author')}:</span> {openImg.author}</div>}
                {openImg.license && <div><span className="text-muted-foreground">{t('plantAdvisor.identify.license')}:</span> {openImg.license}</div>}
                {openImg.citation && <div className="text-muted-foreground italic">{openImg.citation}</div>}
                {openImg.date && <div className="text-muted-foreground">{openImg.date}</div>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {review && review.hasAnyRelatedImages && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Info className="h-3 w-3" />
          {t('plantAdvisor.identify.referenceImagesEphemeralNote')}
        </div>
      )}
      {review && !review.hasAnyRelatedImages && diagnoses.length > 0 && (
        <div className="text-[11px] text-muted-foreground flex items-start gap-1">
          <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>{t('plantAdvisor.diagnose.noReferenceImagesReturned')}</span>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="truncate">{value || '—'}</div>
    </div>
  );
}
