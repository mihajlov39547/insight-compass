import React, { useEffect, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AVAILABLE_LANGUAGES, normalizeLanguageCode, type AvailableLanguageCode } from '@/lib/languages';
import { useTranslation } from 'react-i18next';

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject: (name: string, description: string, language: AvailableLanguageCode) => void;
}

export function NewProjectDialog({ open, onOpenChange, onCreateProject }: NewProjectDialogProps) {
  const { t, i18n } = useTranslation();
  const currentLanguage = normalizeLanguageCode(i18n.resolvedLanguage || i18n.language);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState<AvailableLanguageCode>(currentLanguage);
  const [nameError, setNameError] = useState('');
  const [descriptionError, setDescriptionError] = useState('');

  useEffect(() => {
    if (open) {
      setLanguage(currentLanguage);
    }
  }, [currentLanguage, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setNameError(t('newProject.errors.nameRequired'));
      return;
    }
    if (!description.trim()) {
      setDescriptionError(t('newProject.errors.descriptionRequired'));
      return;
    }
    
    onCreateProject(name.trim(), description.trim(), language);
    handleClose();
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setLanguage(currentLanguage);
    setNameError('');
    setDescriptionError('');
    onOpenChange(false);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (value.trim()) {
      setNameError('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <FolderPlus className="h-5 w-5 text-accent" />
            </div>
            <div>
              <DialogTitle>{t('newProject.title')}</DialogTitle>
              <DialogDescription>
                {t('newProject.description')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">
              {t('newProject.name')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="project-name"
              placeholder={t('newProject.namePlaceholder')}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className={nameError ? 'border-destructive focus-visible:ring-destructive' : ''}
              autoFocus
            />
            {nameError && (
              <p className="text-sm text-destructive animate-fade-in">{nameError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-description">
              {t('newProject.descriptionLabel')} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="project-description"
              placeholder={t('newProject.descriptionPlaceholder')}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (e.target.value.trim()) setDescriptionError('');
              }}
              rows={3}
              className={`resize-none ${descriptionError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
            />
            {descriptionError && (
              <p className="text-sm text-destructive animate-fade-in">{descriptionError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t('newProject.descriptionHelp')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-language">{t('newProject.language')}</Label>
            <Select value={language} onValueChange={(val: AvailableLanguageCode) => setLanguage(val)}>
              <SelectTrigger id="project-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_LANGUAGES.map((availableLanguage) => (
                  <SelectItem key={availableLanguage.code} value={availableLanguage.code}>
                    {t(availableLanguage.translationKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>
              {t('newProject.cancel')}
            </Button>
            <Button type="submit" className="bg-accent hover:bg-accent/90 text-accent-foreground">
              {t('newProject.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
