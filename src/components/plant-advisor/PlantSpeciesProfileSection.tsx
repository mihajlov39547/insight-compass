import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, RefreshCw, Leaf, ChevronDown, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  useEnrichPlantProfile,
  useAutoEnrichPlantProfile,
} from '@/hooks/usePlantSpeciesProfile';
import { usePlantIdentifications } from '@/hooks/usePlantIdentifications';

interface Props {
  caseId: string;
  hasConfirmedIdentification: boolean;
}

const ERROR_I18N_KEY: Record<string, string> = {
  missing_case_id: 'plantAdvisor.trefle.errors.missing_case_id',
  case_not_found: 'plantAdvisor.trefle.errors.case_not_found',
  forbidden: 'plantAdvisor.trefle.errors.forbidden',
  no_confirmed_identification: 'plantAdvisor.trefle.errors.no_confirmed_identification',
  identification_not_found: 'plantAdvisor.trefle.errors.identification_not_found',
  no_trefle_match: 'plantAdvisor.trefle.noProfileFound',
  profile_save_failed: 'plantAdvisor.trefle.errors.profile_save_failed',
  internal_error: 'plantAdvisor.trefle.errors.internal_error',
  missing_trefle_token: 'plantAdvisor.trefle.errors.internal_error',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div className="grid grid-cols-3 gap-2 text-xs py-1 border-b border-border/50 last:border-0">
      <div className="text-muted-foreground col-span-1">{label}</div>
      <div className="col-span-2 break-words">{value}</div>
    </div>
  );
}

function joinList(v: unknown): string | null {
  if (Array.isArray(v)) {
    const arr = v.filter((x) => typeof x === 'string' && x.trim()) as string[];
    return arr.length ? arr.join(', ') : null;
  }
  if (typeof v === 'string') return v || null;
  return null;
}

function fmt(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v || null;
  return null;
}

function normalizeSciName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function firstTwoTokens(s: string | null | undefined): string {
  const parts = normalizeSciName(s).split(' ').filter(Boolean);
  return parts.slice(0, 2).join(' ');
}

interface GroupProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}
function Group({ title, defaultOpen, children }: GroupProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between px-3 py-2 rounded-md border border-border bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        >
          <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function OrganImages({
  organ,
  imgs,
}: {
  organ: string;
  imgs: Array<{ url?: string; copyright?: string }>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const visible = expanded ? imgs : imgs.slice(0, 6);
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground mb-1 capitalize">{organ}</div>
      <div className="flex flex-wrap gap-2">
        {visible.map((im, i) =>
          im?.url ? (
            <figure key={i} className="w-24 flex-shrink-0">
              <button
                type="button"
                onClick={() => setPreview(im.url!)}
                className="block w-24 h-24 rounded-md border border-border overflow-hidden hover:ring-2 hover:ring-primary/40 transition"
              >
                <img
                  src={im.url}
                  alt={`${organ} ${i + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
              {im.copyright && (
                <figcaption className="text-[9px] text-muted-foreground truncate mt-0.5">
                  © {im.copyright}
                </figcaption>
              )}
            </figure>
          ) : null,
        )}
      </div>
      {imgs.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-primary hover:underline"
        >
          {expanded ? t('plantAdvisor.trefle.showLess') : t('plantAdvisor.trefle.showMore')}
        </button>
      )}
      {preview && (
        <div
          role="dialog"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white p-2 rounded-md bg-black/40 hover:bg-black/60"
            onClick={(e) => {
              e.stopPropagation();
              setPreview(null);
            }}
            aria-label="close"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={preview}
            alt="preview"
            className="max-h-[90vh] max-w-[90vw] rounded-md shadow-xl object-contain"
          />
        </div>
      )}
    </div>
  );
}

export function PlantSpeciesProfileSection({ caseId, hasConfirmedIdentification }: Props) {
  const { t, i18n } = useTranslation();
  const { profile } = useAutoEnrichPlantProfile({ caseId, hasConfirmedIdentification });
  const enrich = useEnrichPlantProfile();
  const { data: idents = [] } = usePlantIdentifications(hasConfirmedIdentification ? caseId : null);

  const confirmedIdent = useMemo(
    () => (idents as any[]).find((i) => i.is_confirmed) ?? null,
    [idents],
  );
  const confirmedSciName: string | null =
    confirmedIdent?.scientific_name_without_author || confirmedIdent?.scientific_name || null;

  if (!hasConfirmedIdentification) return null;

  const row = profile.data;
  const p = row?.profile as any | undefined;

  const trefleSci = p?.scientificName ?? row?.scientific_name ?? null;
  const nameMismatch =
    !!confirmedSciName &&
    !!trefleSci &&
    firstTwoTokens(confirmedSciName) !== firstTwoTokens(trefleSci);

  const fetchedAt = row?.fetched_at ? new Date(row.fetched_at) : null;
  const dateLocale = i18n.language?.startsWith('sr') ? undefined : undefined;

  const scale = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : null;
    if (n == null || Number.isNaN(n)) return null;
    return t('plantAdvisor.trefle.scaleValue', { value: n });
  };

  const rangeMinMax = (
    minV: unknown,
    maxV: unknown,
    unit: string,
  ): string | null => {
    const min = typeof minV === 'number' ? minV : minV != null && minV !== '' ? Number(minV) : null;
    const max = typeof maxV === 'number' ? maxV : maxV != null && maxV !== '' ? Number(maxV) : null;
    const hasMin = min != null && !Number.isNaN(min);
    const hasMax = max != null && !Number.isNaN(max);
    if (hasMin && hasMax) return `${min}–${max}${unit ? ' ' + unit : ''}`;
    if (hasMin) return t('plantAdvisor.trefle.rangeMin', { value: `${min}${unit ? ' ' + unit : ''}` });
    if (hasMax) return t('plantAdvisor.trefle.rangeMax', { value: `${max}${unit ? ' ' + unit : ''}` });
    return null;
  };

  const onRefresh = async () => {
    try {
      const res = await enrich.mutateAsync({ plantCaseId: caseId, force: true });
      if (res?.ok) toast.success(t('plantAdvisor.trefle.refreshedToast'));
      else toast.error(t('plantAdvisor.trefle.noProfileFound'));
    } catch (e: any) {
      const code = e?.code || e?.message;
      const key = code && ERROR_I18N_KEY[code];
      toast.error(key ? t(key) : t('plantAdvisor.trefle.errorGeneric'));
    }
  };

  const growth = p?.growth ?? {};
  const phRange = rangeMinMax(growth?.ph_minimum, growth?.ph_maximum, '');
  const tempRange = rangeMinMax(
    growth?.minimum_temperature?.deg_c,
    growth?.maximum_temperature?.deg_c,
    '°C',
  );
  const precipRange = rangeMinMax(
    growth?.minimum_precipitation?.mm,
    growth?.maximum_precipitation?.mm,
    'mm',
  );
  const rootDepthCm = growth?.minimum_root_depth?.cm;

  const sources = Array.isArray(p?.sources) ? (p.sources as any[]) : [];

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <BookOpen className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{t('plantAdvisor.trefle.sectionTitle')}</div>
          <div className="text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">Trefle</Badge>
            <span className="ml-1.5">{t('plantAdvisor.trefle.strongProviderNote')}</span>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={enrich.isPending}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${enrich.isPending ? 'animate-spin' : ''}`} />
          {t('plantAdvisor.trefle.refresh')}
        </Button>
      </div>

      {(profile.isLoading || enrich.isPending) && !row && (
        <div className="text-xs text-muted-foreground">{t('plantAdvisor.trefle.loading')}</div>
      )}

      {!profile.isLoading && !row && !enrich.isPending && (
        <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border/60 px-2 py-1.5 flex items-center gap-1.5">
          <Leaf className="h-3.5 w-3.5" />
          {t('plantAdvisor.trefle.noProfileFound')}
        </div>
      )}

      {row && p && (
        <div className="space-y-3">
          {/* Compact summary header */}
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{trefleSci ?? '—'}</span>
              {p.commonName && (
                <span className="text-xs text-muted-foreground">· {p.commonName}</span>
              )}
              <Badge variant="outline" className="text-[10px] ml-auto">
                {t('plantAdvisor.trefle.matchedBy')}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground">
              {(p.family || p.genus) && (
                <span>
                  {[p.family, p.genus].filter(Boolean).join(' · ')}
                </span>
              )}
              {(p.status || p.rank) && (
                <span>· {[p.rank, p.status].filter(Boolean).join(' · ')}</span>
              )}
              {fetchedAt && (
                <span className="ml-auto">
                  {t('plantAdvisor.trefle.summary.fetched', {
                    date: format(fetchedAt, 'PP', { locale: dateLocale }),
                  })}
                </span>
              )}
            </div>
          </div>

          {nameMismatch && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>{t('plantAdvisor.trefle.summary.matchWarning')}</div>
            </div>
          )}

          {/* Plant profile - default open */}
          <Group title={t('plantAdvisor.trefle.plantProfile')} defaultOpen>
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <Row label={t('plantAdvisor.trefle.fields.scientific')} value={p.scientificName} />
              <Row label={t('plantAdvisor.trefle.fields.common')} value={p.commonName} />
              <Row
                label={t('plantAdvisor.trefle.fields.family')}
                value={p.family || p.familyCommonName}
              />
              <Row label={t('plantAdvisor.trefle.fields.genus')} value={p.genus} />
              <Row label={t('plantAdvisor.trefle.fields.rank')} value={p.rank} />
              <Row label={t('plantAdvisor.trefle.fields.status')} value={p.status} />
              <Row label={t('plantAdvisor.trefle.fields.author')} value={p.author} />
              <Row label={t('plantAdvisor.trefle.synonyms')} value={joinList(p.synonyms)} />
            </div>
          </Group>

          {/* Growth requirements - default open */}
          {(growth || p.specifications) && (
            <Group title={t('plantAdvisor.trefle.growthRequirements')} defaultOpen>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                <Row label={t('plantAdvisor.trefle.growth.phRange')} value={phRange} />
                <Row label={t('plantAdvisor.trefle.growth.light')} value={scale(growth?.light)} />
                <Row
                  label={t('plantAdvisor.trefle.growth.humidity')}
                  value={scale(growth?.atmospheric_humidity)}
                />
                <Row
                  label={t('plantAdvisor.trefle.growth.soilNutriments')}
                  value={scale(growth?.soil_nutriments)}
                />
                <Row
                  label={t('plantAdvisor.trefle.growth.soilSalinity')}
                  value={scale(growth?.soil_salinity)}
                />
                <Row
                  label={t('plantAdvisor.trefle.growth.soilTexture')}
                  value={scale(growth?.soil_texture)}
                />
                <Row
                  label={t('plantAdvisor.trefle.growth.soilHumidity')}
                  value={scale(growth?.soil_humidity)}
                />
                <Row label={t('plantAdvisor.trefle.growth.tempRange')} value={tempRange} />
                <Row
                  label={t('plantAdvisor.trefle.growth.precipitationRange')}
                  value={precipRange}
                />
                <Row
                  label={t('plantAdvisor.trefle.growth.minRootDepth')}
                  value={fmt(rootDepthCm) && `${rootDepthCm} cm`}
                />
                <Row
                  label={t('plantAdvisor.trefle.growth.growthMonths')}
                  value={joinList(growth?.growth_months)}
                />
                <Row
                  label={t('plantAdvisor.trefle.growth.bloomMonths')}
                  value={joinList(growth?.bloom_months)}
                />
                <Row
                  label={t('plantAdvisor.trefle.growth.fruitMonths')}
                  value={joinList(growth?.fruit_months)}
                />
                <Row label={t('plantAdvisor.trefle.growth.duration')} value={joinList(p.duration)} />
              </div>
            </Group>
          )}

          {/* Reference images - default collapsed */}
          {(p.imageUrl || (p.imagesByOrgan && Object.keys(p.imagesByOrgan).length > 0)) && (
            <Group title={t('plantAdvisor.trefle.referenceImages')}>
              <div className="space-y-2">
                {p.imageUrl && (
                  <img
                    src={p.imageUrl}
                    alt={p.scientificName ?? 'plant'}
                    className="w-full max-w-xs rounded-md border border-border object-cover"
                    loading="lazy"
                  />
                )}
                {p.imagesByOrgan &&
                  Object.entries(
                    p.imagesByOrgan as Record<
                      string,
                      Array<{ url?: string; copyright?: string }>
                    >,
                  ).map(([organ, imgs]) =>
                    Array.isArray(imgs) && imgs.length > 0 ? (
                      <OrganImages key={organ} organ={organ} imgs={imgs} />
                    ) : null,
                  )}
              </div>
            </Group>
          )}

          {/* Safety and use - default collapsed */}
          <Group title={t('plantAdvisor.trefle.safetyUse')}>
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <Row label={t('plantAdvisor.trefle.edible')} value={fmt(p.edible)} />
              <Row label={t('plantAdvisor.trefle.ediblePart')} value={joinList(p.ediblePart)} />
              <Row label={t('plantAdvisor.trefle.vegetable')} value={fmt(p.vegetable)} />
              <Row label={t('plantAdvisor.trefle.toxicity')} value={fmt(p.toxicity)} />
            </div>
          </Group>

          {/* Distribution - default collapsed */}
          {p.distributions && (
            <Group title={t('plantAdvisor.trefle.distribution')}>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                <Row
                  label={t('plantAdvisor.trefle.native')}
                  value={joinList(
                    (p.distributions.native ?? []).map((d: any) => d?.name).filter(Boolean),
                  )}
                />
                <Row
                  label={t('plantAdvisor.trefle.introduced')}
                  value={joinList(
                    (p.distributions.introduced ?? []).map((d: any) => d?.name).filter(Boolean),
                  )}
                />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {t('plantAdvisor.trefle.incompleteNote')}
              </div>
            </Group>
          )}

          {/* Sources - default collapsed */}
          {sources.length > 0 && (
            <Group title={t('plantAdvisor.trefle.sources')}>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 space-y-2">
                {sources.map((s, i) => {
                  const name =
                    (typeof s === 'string' ? s : s?.name || s?.source || s?.title) ?? null;
                  const citation = typeof s === 'object' ? s?.citation ?? null : null;
                  const url = typeof s === 'object' ? s?.url ?? null : null;
                  return (
                    <div
                      key={i}
                      className="text-xs border-b border-border/50 last:border-0 pb-2 last:pb-0"
                    >
                      {name && <div className="font-medium">{name}</div>}
                      {citation && <div className="text-muted-foreground mt-0.5">{citation}</div>}
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline break-all"
                        >
                          {url}
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </Group>
          )}
        </div>
      )}
    </div>
  );
}
