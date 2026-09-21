import React from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PhotoQualitySummary } from '@/lib/plantPhotoQuality';

interface Props {
  photoQuality: PhotoQualitySummary;
  onAddPhotos: () => void;
}

const STATUS_CLASS: Record<PhotoQualitySummary['status'], string> = {
  good: 'border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  needs_more_photos: 'border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300',
  insufficient: 'border-transparent bg-destructive/10 text-destructive',
};

export function PlantPhotoQualityCard({ photoQuality, onAddPhotos }: Props) {
  const { t } = useTranslation();
  const visibleMissing = [
    ...photoQuality.visualMissingPhotos,
    ...photoQuality.missingPhotoKeys.map((k) => t(`plantAdvisor.photoQuality.missing.${k}`)),
  ]
    .filter(Boolean)
    .filter((item, index, all) => all.findIndex((x) => x.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 4);

  return (
    <section className="rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
          <Camera className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">{t('plantAdvisor.photoQuality.title')}</h3>
            <Badge variant="outline" className={cn('text-[10px]', STATUS_CLASS[photoQuality.status])}>
              {t(`plantAdvisor.photoQuality.status.${photoQuality.status}`)}
            </Badge>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{t(`plantAdvisor.photoQuality.summary.${photoQuality.status}`)}</p>
            <p>{t('plantAdvisor.photoQuality.helper')}</p>
          </div>
          {visibleMissing.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('plantAdvisor.photoQuality.missingTitle')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {visibleMissing.map((item) => (
                  <Badge key={item} variant="secondary" className="text-[10px] font-normal">
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-8 flex-shrink-0" onClick={onAddPhotos}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          {t('plantAdvisor.photoQuality.addPhotos')}
        </Button>
      </div>
    </section>
  );
}