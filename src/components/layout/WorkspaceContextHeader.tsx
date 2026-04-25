import React from 'react';
import { Search, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslation } from 'react-i18next';
import { AVAILABLE_LANGUAGES, normalizeLanguageCode } from '@/lib/languages';

interface WorkspaceContextHeaderProps {
  title: React.ReactNode;
  subtitle?: string | null;
  language?: string | null;
  languageContext?: 'workspace' | 'notebook';
  showShare?: boolean;
  onShare?: () => void;
}

export function WorkspaceContextHeader({
  title,
  subtitle,
  language,
  languageContext = 'workspace',
  showShare = false,
  onShare,
}: WorkspaceContextHeaderProps) {
  const { t } = useTranslation();
  const normalizedLanguage = normalizeLanguageCode(language);
  const languageConfig = AVAILABLE_LANGUAGES.find(item => item.code === normalizedLanguage);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card shrink-0 animate-fade-in">
      <div className="flex-1 min-w-0">
        <div className="text-lg font-semibold text-foreground truncate">{title}</div>
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-xs text-muted-foreground">{subtitle || t('projectDashboard.noDescription')}</p>
          {language && (
            <span className="inline-flex shrink-0 items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t(`workspace.${languageContext}LanguageBadge`, { language: t(languageConfig?.translationKey || 'languages.en') })}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('projectDashboard.searchInChat')} className="pl-9 h-8 text-sm bg-secondary/50" />
        </div>

        {showShare && (
          <Button variant="outline" size="sm" className="gap-2" onClick={onShare}>
            <Share2 className="h-4 w-4" /> {t('projectDashboard.share')}
          </Button>
        )}
      </div>
    </div>
  );
}
