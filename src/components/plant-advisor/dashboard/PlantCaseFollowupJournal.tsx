import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { AlertTriangle, BookOpen, ImagePlus, MessageSquare, Plus, RefreshCw, Scale, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { PlantDashboardSection } from './PlantDashboardSection';
import {
  useCreatePlantCaseFollowup,
  useDeletePlantCaseFollowup,
  linkImagesToFollowup,
  type PlantCaseFollowup,
} from '@/hooks/usePlantCaseFollowups';
import { useUploadPlantImage, usePlantCaseImages } from '@/hooks/usePlantCaseImages';
import {
  FOLLOWUP_AREAS,
  FOLLOWUP_OUTCOMES,
  type FollowupArea,
  type FollowupOutcome,
  type FollowupReview,
} from '@/lib/plantFollowupReview';

const OUTCOME_CLASS: Record<FollowupOutcome, string> = {
  improved: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  resolved: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200',
  unchanged: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
  worse: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
};

function defaultArea(goal: string): FollowupArea {
  if (goal === 'diagnose') return 'diagnosis';
  if (goal === 'improve_growth') return 'growth';
  if (goal === 'increase_income') return 'income';
  if (goal === 'identify') return 'identification';
  return 'general';
}

interface Props {
  caseId: string;
  goal: string;
  canEdit: boolean;
  followups: PlantCaseFollowup[];
  review: FollowupReview;
  onAskChat: (prompt: string) => void;
  onCompareCandidates: () => void;
  onRerunDiagnosis: () => void;
  onRerunVisualCheck: () => void;
}

export function PlantCaseFollowupJournal({
  caseId,
  goal,
  canEdit,
  followups,
  review,
  onAskChat,
  onCompareCandidates,
  onRerunDiagnosis,
  onRerunVisualCheck,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<FollowupOutcome>('unknown');
  const [area, setArea] = useState<FollowupArea>(defaultArea(goal));
  const [files, setFiles] = useState<File[]>([]);
  const [confirmRerun, setConfirmRerun] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const create = useCreatePlantCaseFollowup();
  const del = useDeletePlantCaseFollowup();
  const upload = useUploadPlantImage();
  const { data: images = [] } = usePlantCaseImages(caseId);
  const [saving, setSaving] = useState(false);

  const photoCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const img of images as Array<{ followup_id?: string | null }>) {
      if (img.followup_id) m.set(img.followup_id, (m.get(img.followup_id) ?? 0) + 1);
    }
    return m;
  }, [images]);

  const latest = followups[0];
  const outcomeLabel = (o: FollowupOutcome) => t(`plantAdvisor.followups.outcomes.${o}`);

  const askPrompt = (o: FollowupOutcome) =>
    t('plantAdvisor.followups.chatPrompt', { outcome: outcomeLabel(o).toLowerCase() });

  const resetForm = () => {
    setTitle('');
    setNote('');
    setOutcome('unknown');
    setFiles([]);
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setFormOpen(false);
  };

  const handleSave = async () => {
    if (!note.trim() && !title.trim()) {
      toast.error(t('plantAdvisor.followups.needNote'));
      return;
    }
    setSaving(true);
    try {
      const row = await create.mutateAsync({
        caseId,
        followup_date: date,
        title: title.trim() || null,
        note: note.trim() || null,
        outcome_status: outcome,
        related_area: area,
      });
      if (files.length > 0) {
        const ids: string[] = [];
        let count = images.length;
        for (const f of files) {
          try {
            const img = await upload.mutateAsync({
              caseId,
              file: f,
              role: 'auto',
              currentImagesInCase: count,
              currentTotalImages: count,
            });
            ids.push(img.id);
            count += 1;
          } catch (e) {
            toast.error((e as Error).message);
          }
        }
        await linkImagesToFollowup(ids, row.id);
      }
      toast.success(t('plantAdvisor.followups.savedToast'));
      resetForm();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const summary = latest ? (
    <span className="line-clamp-1">
      {t('plantAdvisor.followups.latestPrefix')} {latest.title || latest.note}
    </span>
  ) : (
    t('plantAdvisor.followups.empty')
  );

  return (
    <PlantDashboardSection
      icon={<BookOpen className="h-4 w-4" />}
      title={t('plantAdvisor.followups.title')}
      statusLabel={
        latest
          ? `${outcomeLabel(latest.outcome_status)} · ${format(new Date(latest.followup_date), 'PP')}`
          : t('plantAdvisor.followups.none')
      }
      statusTone={!latest ? 'optional' : latest.outcome_status === 'worse' ? 'warning' : latest.outcome_status === 'improved' || latest.outcome_status === 'resolved' ? 'ready' : 'pending'}
      summary={summary}
      expandLabel={t('plantAdvisor.dashboard.expand')}
      collapseLabel={t('plantAdvisor.dashboard.collapse')}
      open={open}
      onOpenChange={setOpen}
      actions={
        canEdit ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(true);
              setFormOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('plantAdvisor.followups.add')}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {review.hasFollowups && review.reasons.length > 0 && (
          <div
            className={cn(
              'rounded-lg border p-3 text-sm',
              review.needsReevaluation
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-border bg-muted/30',
            )}
          >
            {review.needsReevaluation && (
              <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                {t('plantAdvisor.followups.reevaluation')}
              </div>
            )}
            <p className="mt-1 text-muted-foreground">
              {t(`plantAdvisor.followups.reasons.${review.reasons[0]}`)}
            </p>
            {review.suggestedAction !== 'none' && (
              <div className="mt-2 flex flex-wrap gap-2">
                {review.suggestedAction === 'compare_candidates' && (
                  <Button size="sm" variant="outline" onClick={onCompareCandidates}>
                    <Scale className="h-3.5 w-3.5 mr-1" />
                    {t('plantAdvisor.followups.compare')}
                  </Button>
                )}
                {review.suggestedAction === 'rerun_diagnosis' && canEdit && (
                  <Button size="sm" variant="outline" onClick={() => setConfirmRerun(true)}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    {t('plantAdvisor.followups.rerunDiagnosis')}
                  </Button>
                )}
                {review.suggestedAction === 'rerun_visual_check' && (
                  <Button size="sm" variant="outline" onClick={onRerunVisualCheck}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    {t('plantAdvisor.followups.rerunVisual')}
                  </Button>
                )}
                {latest && (
                  <Button size="sm" variant="ghost" onClick={() => onAskChat(askPrompt(latest.outcome_status))}>
                    <MessageSquare className="h-3.5 w-3.5 mr-1" />
                    {t('plantAdvisor.followups.askChat')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {formOpen && canEdit && (
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('plantAdvisor.followups.date')}</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('plantAdvisor.followups.outcome')}</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as FollowupOutcome)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FOLLOWUP_OUTCOMES.map((o) => (
                      <SelectItem key={o} value={o}>{outcomeLabel(o)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('plantAdvisor.followups.area')}</Label>
                <Select value={area} onValueChange={(v) => setArea(v as FollowupArea)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FOLLOWUP_AREAS.map((a) => (
                      <SelectItem key={a} value={a}>{t(`plantAdvisor.followups.areas.${a}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('plantAdvisor.followups.titleLabel')}</Label>
              <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('plantAdvisor.followups.whatChanged')}</Label>
              <Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              <Button size="sm" variant="outline" type="button" onClick={() => fileRef.current?.click()}>
                <ImagePlus className="h-3.5 w-3.5 mr-1" />
                {t('plantAdvisor.followups.addPhotos')}
              </Button>
              {files.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t('plantAdvisor.followups.photoCount', { count: files.length })}
                </span>
              )}
              <div className="flex-1" />
              <Button size="sm" variant="ghost" onClick={resetForm} disabled={saving}>
                {t('plantAdvisor.followups.cancel')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {t('plantAdvisor.followups.save')}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('plantAdvisor.followups.disclaimer')}</p>
          </div>
        )}

        {followups.length === 0 && !formOpen && (
          <p className="text-sm text-muted-foreground">{t('plantAdvisor.followups.empty')}</p>
        )}

        <ul className="space-y-2">
          {followups.map((f) => {
            const photos = photoCounts.get(f.id) ?? 0;
            return (
              <li key={f.id} className="rounded-lg border border-border/60 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{format(new Date(f.followup_date), 'PP')}</span>
                  <Badge className={cn('border-transparent', OUTCOME_CLASS[f.outcome_status])}>
                    {outcomeLabel(f.outcome_status)}
                  </Badge>
                  <span className="text-muted-foreground">{t(`plantAdvisor.followups.areas.${f.related_area}`)}</span>
                  {photos > 0 && (
                    <span className="text-muted-foreground">
                      · {t('plantAdvisor.followups.photoCount', { count: photos })}
                    </span>
                  )}
                </div>
                {f.title && <div className="mt-1 text-sm font-medium">{f.title}</div>}
                {f.note && <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{f.note}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onAskChat(askPrompt(f.outcome_status))}>
                    <MessageSquare className="h-3.5 w-3.5 mr-1" />
                    {t('plantAdvisor.followups.askChat')}
                  </Button>
                  {goal === 'diagnose' && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCompareCandidates}>
                      <Scale className="h-3.5 w-3.5 mr-1" />
                      {t('plantAdvisor.followups.compare')}
                    </Button>
                  )}
                  {goal === 'diagnose' && canEdit && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setConfirmRerun(true)}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      {t('plantAdvisor.followups.rerunDiagnosis')}
                    </Button>
                  )}
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 ml-auto text-muted-foreground"
                      aria-label={t('plantAdvisor.followups.delete')}
                      onClick={async () => {
                        if (!confirm(t('plantAdvisor.followups.confirmDelete'))) return;
                        try {
                          await del.mutateAsync({ id: f.id, case_id: f.case_id });
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <AlertDialog open={confirmRerun} onOpenChange={setConfirmRerun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('plantAdvisor.followups.rerunTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('plantAdvisor.followups.rerunBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('plantAdvisor.followups.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={onRerunDiagnosis}>{t('plantAdvisor.followups.rerunConfirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PlantDashboardSection>
  );
}
