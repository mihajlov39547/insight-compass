import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sprout, RefreshCw, Download, ExternalLink, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  usePermapeopleProfile,
  useFetchPermapeopleProfile,
} from '@/hooks/usePermapeopleProfile';

interface Props {
  caseId: string;
  hasConfirmedIdentification: boolean;
}

const ERROR_I18N_KEY: Record<string, string> = {
  missing_permapeople_credentials: 'plantAdvisor.permapeople.errors.config',
  permapeople_unauthorized: 'plantAdvisor.permapeople.errors.config',
  unauthorized: 'plantAdvisor.permapeople.errors.config',
  case_not_found: 'plantAdvisor.permapeople.errors.generic',
  forbidden: 'plantAdvisor.permapeople.errors.generic',
  no_confirmed_identification: 'plantAdvisor.permapeople.needsConfirmed',
  no_permapeople_match: 'plantAdvisor.permapeople.noProfileFound',
  profile_save_failed: 'plantAdvisor.permapeople.errors.generic',
  internal_error: 'plantAdvisor.permapeople.errors.generic',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <div className="grid grid-cols-3 gap-2 text-xs py-1 border-b border-border/50 last:border-0">
      <div className="text-muted-foreground col-span-1">{label}</div>
      <div className="col-span-2 break-words">{value}</div>
    </div>
  );
}

export function PermapeoplePlantProfileSection({ caseId, hasConfirmedIdentification }: Props) {
  const { t } = useTranslation();
  const query = usePermapeopleProfile(caseId);
  const fetchProfile = useFetchPermapeopleProfile();

  const row = query.data ?? null;
  const nd = row?.normalized_data ?? {};
  const payload = row?.profile_payload ?? {};

  const run = async (force: boolean) => {
    try {
      const res = await fetchProfile.mutateAsync({ caseId, force });
      if (res?.ok) toast.success(t('plantAdvisor.permapeople.fetchedToast'));
      else toast.error(t('plantAdvisor.permapeople.noProfileFound'));
    } catch (e: any) {
      const code = e?.code || e?.message;
      const key = code && ERROR_I18N_KEY[code];
      toast.error(key ? t(key) : t('plantAdvisor.permapeople.errors.generic'));
    }
  };

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <Sprout className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{t('plantAdvisor.permapeople.title')}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              Permapeople
            </Badge>
            {row && (
              <span>
                {t('plantAdvisor.permapeople.fetchedAt', {
                  date: format(new Date(row.fetched_at), 'PP'),
                })}
              </span>
            )}
          </div>
        </div>
        {hasConfirmedIdentification && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(!!row)}
            disabled={fetchProfile.isPending}
          >
            {row ? (
              <RefreshCw
                className={`h-4 w-4 mr-1.5 ${fetchProfile.isPending ? 'animate-spin' : ''}`}
              />
            ) : (
              <Download className="h-4 w-4 mr-1.5" />
            )}
            {row ? t('plantAdvisor.permapeople.refresh') : t('plantAdvisor.permapeople.fetch')}
          </Button>
        )}
      </div>

      {!hasConfirmedIdentification && (
        <div className="text-xs text-muted-foreground">
          {t('plantAdvisor.permapeople.needsConfirmed')}
        </div>
      )}

      {hasConfirmedIdentification && !row && !query.isLoading && !fetchProfile.isPending && (
        <div className="text-xs text-muted-foreground">
          {t('plantAdvisor.permapeople.notFetched')}
        </div>
      )}

      {fetchProfile.isPending && !row && (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.permapeople.loading')}</div>
      )}

      {row && (
        <div className="space-y-2">
          {row.match_confidence && row.match_confidence !== 'high' && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>{t('plantAdvisor.permapeople.approximateMatch')}</div>
            </div>
          )}

          <div className="flex items-start gap-3">
            {row.image_thumb_url && (
              <img
                src={row.image_thumb_url}
                alt={row.scientific_name ?? 'plant'}
                loading="lazy"
                className="h-20 w-20 rounded-md border border-border object-cover flex-shrink-0"
              />
            )}
            <div className="min-w-0 text-xs space-y-1">
              <div className="text-sm font-medium">{row.common_name ?? row.scientific_name}</div>
              <div className="italic text-muted-foreground">{row.scientific_name}</div>
              {payload?.description && (
                <p className="text-muted-foreground line-clamp-4">{payload.description}</p>
              )}
            </div>
          </div>

          <div>
            <Row label={t('plantAdvisor.permapeople.fields.family')} value={row.family} />
            <Row label={t('plantAdvisor.permapeople.fields.type')} value={row.type} />
            <Row label={t('plantAdvisor.permapeople.fields.water')} value={nd.waterRequirement} />
            <Row label={t('plantAdvisor.permapeople.fields.light')} value={nd.lightRequirement} />
            <Row label={t('plantAdvisor.permapeople.fields.soil')} value={nd.soilType} />
            <Row label={t('plantAdvisor.permapeople.fields.hardiness')} value={nd.hardinessZone} />
            <Row label={t('plantAdvisor.permapeople.fields.growth')} value={nd.growth} />
            <Row label={t('plantAdvisor.permapeople.fields.layer')} value={nd.layer} />
            <Row label={t('plantAdvisor.permapeople.fields.edible')} value={nd.edible} />
            <Row label={t('plantAdvisor.permapeople.fields.edibleParts')} value={nd.edibleParts} />
          </div>

          {row.source_url && (
            <a
              href={row.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t('plantAdvisor.permapeople.sourceLink')}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
