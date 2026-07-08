import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  PlantIdentification,
  PlantIdentificationReview,
  PlantIdentificationReviewSpecies,
  PlantnetRelatedImage,
} from '@/hooks/usePlantIdentifications';

interface Props {
  review: PlantIdentificationReview | null;
  persistedIdentifications: PlantIdentification[];
  onConfirmSpecies: (identificationId: string) => void;
  isConfirmPending: boolean;
}

function fmtScore(s: number | null | undefined): string {
  if (s == null) return '—';
  return `${Math.round(s * 100)}%`;
}

function pickImgUrl(img: PlantnetRelatedImage): string | null {
  return img.urlMedium || img.urlSmall || img.urlOriginal || null;
}

function ImageStrip({
  images,
  onOpen,
  size = 'md',
}: {
  images: PlantnetRelatedImage[];
  onOpen: (img: PlantnetRelatedImage) => void;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  if (!images || images.length === 0) return null;
  const cls = size === 'sm' ? 'h-14 w-14' : 'h-24 w-24';
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
            className={`relative flex-shrink-0 ${cls} rounded-md overflow-hidden border border-border bg-muted hover:ring-2 hover:ring-primary/50 transition`}
            aria-label={t('plantAdvisor.identify.openImage')}
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

function matchPersisted(
  sp: PlantIdentificationReviewSpecies,
  persisted: PlantIdentification[],
): PlantIdentification | null {
  const byName = persisted.find(
    (p) =>
      (sp.scientificNameWithoutAuthor &&
        p.scientific_name_without_author === sp.scientificNameWithoutAuthor) ||
      (sp.scientificName && p.scientific_name === sp.scientificName),
  );
  if (byName) return byName;
  const byRank = persisted.find((p) => p.rank === sp.rank);
  return byRank ?? null;
}

export function PlantIdentificationReviewPanel({
  review,
  persistedIdentifications,
  onConfirmSpecies,
  isConfirmPending,
}: Props) {
  const { t } = useTranslation();
  const [openImg, setOpenImg] = useState<PlantnetRelatedImage | null>(null);

  if (!review) return null;

  const topSpecies = review.species[0];
  const topGenus = review.genus[0];
  const topFamily = review.family[0];

  const derivedGenus = topGenus?.scientificName || topSpecies?.genus || null;
  const derivedFamily = topFamily?.scientificName || topSpecies?.family || null;

  const hasGenusDetail = review.genus.length > 0;
  const hasFamilyDetail = review.family.length > 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Summary blocks */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <SummaryBlock
          label={t('plantAdvisor.identify.mostLikelySpecies')}
          primary={topSpecies?.commonName || topSpecies?.scientificNameWithoutAuthor || '—'}
          secondary={topSpecies?.scientificNameWithoutAuthor || undefined}
          score={fmtScore(topSpecies?.score)}
        />
        <SummaryBlock
          label={t('plantAdvisor.identify.mostLikelyGenus')}
          primary={derivedGenus || '—'}
          score={topGenus ? fmtScore(topGenus.score) : t('plantAdvisor.identify.fromSpeciesResult')}
        />
        <SummaryBlock
          label={t('plantAdvisor.identify.mostLikelyFamily')}
          primary={derivedFamily || '—'}
          score={topFamily ? fmtScore(topFamily.score) : t('plantAdvisor.identify.fromSpeciesResult')}
        />
      </div>

      <Tabs defaultValue="species">
        <TabsList>
          <TabsTrigger value="species">{t('plantAdvisor.identify.tabs.species')}</TabsTrigger>
          <TabsTrigger value="genus" disabled={!hasGenusDetail}>
            {t('plantAdvisor.identify.tabs.genus')}
          </TabsTrigger>
          <TabsTrigger value="family" disabled={!hasFamilyDetail}>
            {t('plantAdvisor.identify.tabs.family')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="species" className="space-y-3 mt-3">
          {review.species.length === 0 && (
            <div className="text-xs text-muted-foreground">
              {t('plantAdvisor.identify.errors.empty')}
            </div>
          )}
          {review.species.map((sp, idx) => {
            const persisted = matchPersisted(sp, persistedIdentifications);
            const persistedId = persisted?.id ?? null;
            const isTop = idx === 0;
            const isConfirmed = !!persisted?.is_confirmed;
            return (
              <div
                key={`${sp.scientificName}-${idx}`}
                className={`rounded-md border p-3 space-y-2 ${
                  isTop ? 'border-primary/50 bg-primary/5' : 'border-border/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {sp.commonName || sp.scientificNameWithoutAuthor || sp.scientificName || '—'}
                    </div>
                    {sp.scientificNameWithoutAuthor && sp.commonName && (
                      <div className="text-xs italic text-muted-foreground truncate">
                        {sp.scientificNameWithoutAuthor}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      {sp.family || '—'} · {sp.genus || '—'}
                    </div>
                  </div>
                  <Badge variant={isTop ? 'default' : 'outline'} className="text-[10px]">
                    {fmtScore(sp.score)}
                  </Badge>
                </div>
                {sp.relatedImages.length > 0 ? (
                  <ImageStrip
                    images={sp.relatedImages}
                    onOpen={setOpenImg}
                    size={isTop ? 'md' : 'sm'}
                  />
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    {t('plantAdvisor.identify.noReferenceImages')}
                  </div>
                )}
                {persistedId && isTop && (
                  <div>
                    {isConfirmed ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {t('plantAdvisor.identify.confirmed')}
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => onConfirmSpecies(persistedId)}
                        disabled={isConfirmPending}
                      >
                        {t('plantAdvisor.identify.confirmThis')}
                      </Button>
                    )}
                  </div>
                )}
                {persistedId && !isTop && !isConfirmed && (
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => onConfirmSpecies(persistedId)}
                      disabled={isConfirmPending}
                    >
                      {t('plantAdvisor.identify.useThisInstead')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="genus" className="space-y-2 mt-3">
          {!hasGenusDetail && (
            <div className="text-xs text-muted-foreground">
              {t('plantAdvisor.identify.detailedGenusFamilyMissing')}
            </div>
          )}
          {review.genus.map((g, idx) => (
            <div key={`g-${idx}`} className="rounded-md border border-border/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{g.scientificName || '—'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {g.family || '—'}
                    {g.commonNames.length > 0 && ` · ${g.commonNames.slice(0, 3).join(', ')}`}
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {fmtScore(g.score)}
                </Badge>
              </div>
              <ImageStrip images={g.relatedImages} onOpen={setOpenImg} size="sm" />
            </div>
          ))}
        </TabsContent>

        <TabsContent value="family" className="space-y-2 mt-3">
          {!hasFamilyDetail && (
            <div className="text-xs text-muted-foreground">
              {t('plantAdvisor.identify.detailedGenusFamilyMissing')}
            </div>
          )}
          {review.family.map((f, idx) => (
            <div key={`f-${idx}`} className="rounded-md border border-border/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{f.scientificName || '—'}</div>
                  {f.commonNames.length > 0 && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {f.commonNames.slice(0, 3).join(', ')}
                    </div>
                  )}
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {fmtScore(f.score)}
                </Badge>
              </div>
              <ImageStrip images={f.relatedImages} onOpen={setOpenImg} size="sm" />
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <Dialog open={!!openImg} onOpenChange={(o) => !o && setOpenImg(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('plantAdvisor.identify.imageAttribution')}</DialogTitle>
          </DialogHeader>
          {openImg && (
            <div className="space-y-3">
              <img
                src={openImg.urlOriginal || openImg.urlMedium || openImg.urlSmall || ''}
                alt={openImg.organ || ''}
                className="w-full max-h-[60vh] object-contain rounded-md bg-muted"
              />
              <div className="text-xs space-y-1">
                {openImg.organ && (
                  <div>
                    <span className="text-muted-foreground">
                      {t('plantAdvisor.identify.organ')}:
                    </span>{' '}
                    {openImg.organ}
                  </div>
                )}
                {openImg.author && (
                  <div>
                    <span className="text-muted-foreground">
                      {t('plantAdvisor.identify.author')}:
                    </span>{' '}
                    {openImg.author}
                  </div>
                )}
                {openImg.license && (
                  <div>
                    <span className="text-muted-foreground">
                      {t('plantAdvisor.identify.license')}:
                    </span>{' '}
                    {openImg.license}
                  </div>
                )}
                {openImg.citation && (
                  <div className="text-muted-foreground italic">{openImg.citation}</div>
                )}
                {openImg.date && (
                  <div className="text-muted-foreground">{openImg.date}</div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Info className="h-3 w-3" />
        {t('plantAdvisor.identify.referenceImagesEphemeralNote')}
      </div>
    </div>
  );
}

function SummaryBlock({
  label,
  primary,
  secondary,
  score,
}: {
  label: string;
  primary: string;
  secondary?: string;
  score: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium text-sm truncate">{primary}</div>
      {secondary && <div className="text-[11px] italic text-muted-foreground truncate">{secondary}</div>}
      <div className="text-[11px] text-muted-foreground">{score}</div>
    </div>
  );
}
