import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, RefreshCw, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  usePlantSpeciesProfile,
  useEnrichPlantProfile,
  useAutoEnrichPlantProfile,
} from '@/hooks/usePlantSpeciesProfile';

interface Props {
  caseId: string;
  hasConfirmedIdentification: boolean;
}

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

export function PlantSpeciesProfileSection({ caseId, hasConfirmedIdentification }: Props) {
  const { t } = useTranslation();
  const { profile } = useAutoEnrichPlantProfile({ caseId, hasConfirmedIdentification });
  const enrich = useEnrichPlantProfile();

  if (!hasConfirmedIdentification) return null;

  const row = profile.data;
  const p = row?.profile as any | undefined;

  const onRefresh = async () => {
    try {
      const res = await enrich.mutateAsync({ plantCaseId: caseId, force: true });
      if (res?.ok) toast.success(t('plantAdvisor.trefle.refreshedToast'));
      else toast.error(t('plantAdvisor.trefle.noProfileFound'));
    } catch (e: any) {
      if (e?.code === 'no_trefle_match') toast.error(t('plantAdvisor.trefle.noProfileFound'));
      else toast.error(t('plantAdvisor.trefle.errorGeneric'));
    }
  };

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
            <span className="ml-1.5">{t('plantAdvisor.trefle.providerNote')}</span>
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
        <div className="space-y-4">
          {/* Plant profile */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              {t('plantAdvisor.trefle.plantProfile')}
            </h3>
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <Row label={t('plantAdvisor.trefle.fields.scientific')} value={p.scientificName} />
              <Row label={t('plantAdvisor.trefle.fields.common')} value={p.commonName} />
              <Row label={t('plantAdvisor.trefle.fields.family')} value={p.family || p.familyCommonName} />
              <Row label={t('plantAdvisor.trefle.fields.genus')} value={p.genus} />
              <Row label={t('plantAdvisor.trefle.fields.rank')} value={p.rank} />
              <Row label={t('plantAdvisor.trefle.fields.status')} value={p.status} />
              <Row label={t('plantAdvisor.trefle.fields.author')} value={p.author} />
              <Row label={t('plantAdvisor.trefle.synonyms')} value={joinList(p.synonyms)} />
            </div>
          </section>

          {/* Reference images */}
          {(p.imageUrl || (p.imagesByOrgan && Object.keys(p.imagesByOrgan).length > 0)) && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {t('plantAdvisor.trefle.referenceImages')}
              </h3>
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
                  Object.entries(p.imagesByOrgan as Record<string, Array<{ url?: string; copyright?: string }>>).map(
                    ([organ, imgs]) =>
                      Array.isArray(imgs) && imgs.length > 0 ? (
                        <div key={organ}>
                          <div className="text-[11px] font-medium text-muted-foreground mb-1 capitalize">{organ}</div>
                          <div className="flex flex-wrap gap-2">
                            {imgs.slice(0, 6).map((im, i) =>
                              im?.url ? (
                                <figure key={i} className="w-24 flex-shrink-0">
                                  <img
                                    src={im.url}
                                    alt={`${organ} ${i + 1}`}
                                    className="w-24 h-24 object-cover rounded-md border border-border"
                                    loading="lazy"
                                  />
                                  {im.copyright && (
                                    <figcaption className="text-[9px] text-muted-foreground truncate mt-0.5">
                                      © {im.copyright}
                                    </figcaption>
                                  )}
                                </figure>
                              ) : null,
                            )}
                          </div>
                        </div>
                      ) : null,
                  )}
              </div>
            </section>
          )}

          {/* Growth requirements */}
          {(p.growth || p.specifications) && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {t('plantAdvisor.trefle.growthRequirements')}
              </h3>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                <Row label={t('plantAdvisor.trefle.growth.phMin')} value={fmt(p.growth?.ph_minimum)} />
                <Row label={t('plantAdvisor.trefle.growth.phMax')} value={fmt(p.growth?.ph_maximum)} />
                <Row label={t('plantAdvisor.trefle.growth.light')} value={fmt(p.growth?.light)} />
                <Row label={t('plantAdvisor.trefle.growth.humidity')} value={fmt(p.growth?.atmospheric_humidity)} />
                <Row label={t('plantAdvisor.trefle.growth.soilNutriments')} value={fmt(p.growth?.soil_nutriments)} />
                <Row label={t('plantAdvisor.trefle.growth.soilSalinity')} value={fmt(p.growth?.soil_salinity)} />
                <Row label={t('plantAdvisor.trefle.growth.soilTexture')} value={fmt(p.growth?.soil_texture)} />
                <Row label={t('plantAdvisor.trefle.growth.soilHumidity')} value={fmt(p.growth?.soil_humidity)} />
                <Row
                  label={t('plantAdvisor.trefle.growth.tempMin')}
                  value={fmt(p.growth?.minimum_temperature?.deg_c) && `${p.growth.minimum_temperature.deg_c}°C`}
                />
                <Row
                  label={t('plantAdvisor.trefle.growth.tempMax')}
                  value={fmt(p.growth?.maximum_temperature?.deg_c) && `${p.growth.maximum_temperature.deg_c}°C`}
                />
                <Row label={t('plantAdvisor.trefle.growth.precipitation')} value={fmt(p.growth?.minimum_precipitation?.mm)} />
                <Row label={t('plantAdvisor.trefle.growth.rootDepth')} value={fmt(p.growth?.root_depth?.cm)} />
                <Row label={t('plantAdvisor.trefle.growth.growthMonths')} value={joinList(p.growth?.growth_months)} />
                <Row label={t('plantAdvisor.trefle.growth.bloomMonths')} value={joinList(p.growth?.bloom_months)} />
                <Row label={t('plantAdvisor.trefle.growth.fruitMonths')} value={joinList(p.growth?.fruit_months)} />
                <Row label={t('plantAdvisor.trefle.growth.duration')} value={joinList(p.duration)} />
              </div>
            </section>
          )}

          {/* Safety and use */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              {t('plantAdvisor.trefle.safetyUse')}
            </h3>
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <Row label={t('plantAdvisor.trefle.edible')} value={fmt(p.edible)} />
              <Row label={t('plantAdvisor.trefle.ediblePart')} value={joinList(p.ediblePart)} />
              <Row label={t('plantAdvisor.trefle.vegetable')} value={fmt(p.vegetable)} />
              <Row label={t('plantAdvisor.trefle.toxicity')} value={fmt(p.toxicity)} />
            </div>
          </section>

          {/* Distribution */}
          {p.distributions && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {t('plantAdvisor.trefle.distribution')}
              </h3>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
                <Row
                  label={t('plantAdvisor.trefle.native')}
                  value={joinList((p.distributions.native ?? []).map((d: any) => d?.name).filter(Boolean))}
                />
                <Row
                  label={t('plantAdvisor.trefle.introduced')}
                  value={joinList((p.distributions.introduced ?? []).map((d: any) => d?.name).filter(Boolean))}
                />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {t('plantAdvisor.trefle.incompleteNote')}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
