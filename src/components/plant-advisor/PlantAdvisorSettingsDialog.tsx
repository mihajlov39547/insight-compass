import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  usePlantAdvisorSettings,
  type PlantIdentificationLanguage,
  type PlantIdentificationProject,
} from '@/hooks/usePlantAdvisorSettings';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlantAdvisorSettingsDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const s = usePlantAdvisorSettings();

  const [lang, setLang] = React.useState<PlantIdentificationLanguage>(s.identificationLanguage);
  const [project, setProject] = React.useState<PlantIdentificationProject>(s.identificationProject);

  React.useEffect(() => {
    if (open) {
      setLang(s.identificationLanguage);
      setProject(s.identificationProject);
    }
  }, [open, s.identificationLanguage, s.identificationProject]);

  const save = async () => {
    try {
      await s.updateSettings({
        identificationLanguage: lang,
        identificationProject: project,
      });
      toast.success(t('plantAdvisor.settings.saved'));
      onOpenChange(false);
    } catch {
      toast.error(t('plantAdvisor.settings.saveFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('plantAdvisor.settings.title')}</DialogTitle>
          <DialogDescription>{t('plantAdvisor.settings.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t('plantAdvisor.settings.identificationLanguage')}</Label>
            <Select value={lang} onValueChange={(v) => setLang(v as PlantIdentificationLanguage)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t('plantAdvisor.settings.lang.en')}</SelectItem>
                <SelectItem value="sr">{t('plantAdvisor.settings.lang.sr')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t('plantAdvisor.settings.defaultProject')}</Label>
            <Select value={project} onValueChange={(v) => setProject(v as PlantIdentificationProject)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="k-southeastern-europe">
                  {t('plantAdvisor.settings.project.southeasternEurope')}
                </SelectItem>
                <SelectItem value="k-world-flora">
                  {t('plantAdvisor.settings.project.worldFlora')}
                </SelectItem>
                <SelectItem value="all">
                  {t('plantAdvisor.settings.project.all')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={s.isSaving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} disabled={s.isSaving}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
