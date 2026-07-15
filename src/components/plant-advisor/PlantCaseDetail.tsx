import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MessageSquare, Trash2, Pencil, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { useDeletePlantCase, type PlantCase } from '@/hooks/usePlantCases';
import { PlantImageUploader } from './PlantImageUploader';
import { PlantIdentificationSection } from './PlantIdentificationSection';
import { PlantDiseaseDiagnosisSection } from './PlantDiseaseDiagnosisSection';
import { usePlantCaseImages } from '@/hooks/usePlantCaseImages';
import { PlantSpeciesProfileSection } from './PlantSpeciesProfileSection';
import { toast } from 'sonner';

interface Props {
  plantCase: PlantCase;
  onBack: () => void;
  onEdit: () => void;
  onOpenChat: () => void;
  onDeleted: () => void;
}

export function PlantCaseDetail({ plantCase, onBack, onEdit, onOpenChat, onDeleted }: Props) {
  const { t } = useTranslation();
  const del = useDeletePlantCase();
  const { data: images = [] } = usePlantCaseImages(plantCase.id);

  const handleDelete = async () => {
    if (!confirm(t('plantAdvisor.confirmDelete'))) return;
    try {
      await del.mutateAsync(plantCase.id);
      toast.success(t('plantAdvisor.deletedToast'));
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <Leaf className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold truncate">{plantCase.title}</h2>
          <p className="text-xs text-muted-foreground">{format(new Date(plantCase.created_at), 'PP')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-4 w-4 mr-1.5" />{t('common.edit', 'Edit')}</Button>
        <Button variant="ghost" size="sm" onClick={handleDelete} className="text-destructive"><Trash2 className="h-4 w-4 mr-1.5" />{t('common.delete', 'Delete')}</Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary">{t(`plantAdvisor.statuses.${plantCase.status}`)}</Badge>
        {plantCase.user_goal && <Badge variant="outline">{t(`plantAdvisor.goals.${plantCase.user_goal}`)}</Badge>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">{t('plantAdvisor.fields.location')}</div>
          <div>{plantCase.location_text || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t('plantAdvisor.fields.crop')}</div>
          <div>{plantCase.crop_context || '—'}</div>
        </div>
        <div className="sm:col-span-2">
          <div className="text-xs text-muted-foreground">{t('plantAdvisor.fields.notes')}</div>
          <div className="whitespace-pre-wrap">{plantCase.notes || '—'}</div>
        </div>
      </div>

      <PlantImageUploader caseId={plantCase.id} />

      {plantCase.user_goal === 'diagnose' ? (
        <>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('plantAdvisor.diagnoseFlow.step1')}</span>
            {' — '}
            {t('plantAdvisor.diagnoseFlow.identifyFirst')}
          </div>
          <PlantIdentificationSection caseId={plantCase.id} images={images} />

          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('plantAdvisor.diagnoseFlow.step2')}</span>
            {' — '}
            {t('plantAdvisor.diagnoseFlow.diagnoseDisease')}
          </div>
          {plantCase.confirmed_identification_id ? (
            <PlantDiseaseDiagnosisSection
              caseId={plantCase.id}
              images={images}
              hasConfirmedIdentification={true}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              {t('plantAdvisor.diagnoseFlow.step2Locked')}
            </div>
          )}
        </>
      ) : (
        <PlantIdentificationSection caseId={plantCase.id} images={images} />
      )}


      <div className="pt-4 border-t border-border">
        <Button onClick={onOpenChat}>
          <MessageSquare className="h-4 w-4 mr-1.5" />
          {t('plantAdvisor.askAbout')}
        </Button>
      </div>
    </div>
  );
}
