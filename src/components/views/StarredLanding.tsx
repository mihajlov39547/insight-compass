import React from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function StarredLanding() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
        <Star className="h-8 w-8 text-primary" />
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-2">{t('starred.title')}</h1>
      <p className="text-muted-foreground text-center max-w-md">
        {t('starred.description')}
      </p>
    </div>
  );
}
