import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  useCreatePlantCase,
  useUpdatePlantCase,
  PLANT_CASE_GOALS,
  type PlantCase,
  type PlantCaseGoal,
} from '@/hooks/usePlantCases';
import { PlantImageUploader } from './PlantImageUploader';

interface Props {
  initial?: PlantCase | null;
  onSaved: (c: PlantCase) => void;
  onCancel: () => void;
}

export function PlantCaseForm({ initial, onSaved, onCancel }: Props) {
  const { t } = useTranslation();
  const create = useCreatePlantCase();
  const update = useUpdatePlantCase();

  const [title, setTitle] = useState(initial?.title ?? '');
  const [goal, setGoal] = useState<PlantCaseGoal | ''>(initial?.user_goal ?? '');
  const [location, setLocation] = useState(initial?.location_text ?? '');
  const [crop, setCrop] = useState(initial?.crop_context ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [savedCase, setSavedCase] = useState<PlantCase | null>(initial ?? null);

  const isPending = create.isPending || update.isPending;

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error(t('plantAdvisor.errors.titleRequired'));
      return;
    }
    try {
      const payload = {
        title: title.trim(),
        user_goal: (goal || null) as PlantCaseGoal | null,
        location_text: location.trim() || null,
        crop_context: crop.trim() || null,
        notes: notes.trim() || null,
      };
      const result = savedCase
        ? await update.mutateAsync({ id: savedCase.id, patch: payload })
        : await create.mutateAsync(payload);
      setSavedCase(result);
      toast.success(t('plantAdvisor.savedToast'));
      onSaved(result);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{savedCase ? t('plantAdvisor.editCase') : t('plantAdvisor.newScan')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('plantAdvisor.formSubtitle')}</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pa-title">{t('plantAdvisor.fields.title')} *</Label>
          <Input id="pa-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('plantAdvisor.fields.titlePh')} />
        </div>

        <div className="space-y-1.5">
          <Label>{t('plantAdvisor.fields.goal')}</Label>
          <Select value={goal} onValueChange={(v) => setGoal(v as PlantCaseGoal)}>
            <SelectTrigger><SelectValue placeholder={t('plantAdvisor.fields.goalPh')} /></SelectTrigger>
            <SelectContent>
              {PLANT_CASE_GOALS.map((g) => (
                <SelectItem key={g} value={g}>{t(`plantAdvisor.goals.${g}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="pa-loc">{t('plantAdvisor.fields.location')}</Label>
            <Input id="pa-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('plantAdvisor.fields.locationPh')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pa-crop">{t('plantAdvisor.fields.crop')}</Label>
            <Input id="pa-crop" value={crop} onChange={(e) => setCrop(e.target.value)} placeholder={t('plantAdvisor.fields.cropPh')} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pa-notes">{t('plantAdvisor.fields.notes')}</Label>
          <Textarea id="pa-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder={t('plantAdvisor.fields.notesPh')} />
        </div>

        {savedCase ? (
          <PlantImageUploader caseId={savedCase.id} />
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t('plantAdvisor.saveFirstToUpload')}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <Button variant="ghost" onClick={onCancel}>{t('common.cancel', 'Cancel')}</Button>
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          {savedCase ? t('common.save', 'Save') : t('plantAdvisor.saveCase')}
        </Button>
      </div>
    </div>
  );
}
