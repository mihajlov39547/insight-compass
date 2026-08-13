import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, Eye, Leaf, Telescope, Sprout } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PlantCaseDashboardData } from '@/hooks/usePlantCaseDashboard';

interface Props {
  data: PlantCaseDashboardData;
}

function FactCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/80 p-4 space-y-2 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

const pct = (s: number | null | undefined) => (s == null ? '—' : `${Math.round(s * 100)}%`);

/** Compact key facts grid: the answers users want before scrolling anywhere. */
export function PlantCaseKeyFacts({ data }: Props) {
  const { t } = useTranslation();
  const ident = data.confirmedIdent || data.topIdent;
  const diag = data.confirmedDiag || data.topDiag;
  const research = data.primaryResearch;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <FactCard icon={<Leaf className="h-3.5 w-3.5" />} title={t('plantAdvisor.dashboard.facts.plant')}>
        {ident ? (
          <>
            <div className="font-medium truncate">
              {ident.common_name || ident.scientific_name_without_author || ident.scientific_name}
            </div>
            {ident.scientific_name_without_author && (
              <div className="text-xs italic text-muted-foreground truncate">
                {ident.scientific_name_without_author}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <Badge variant="outline" className="text-[10px]">
                {data.identBucket
                  ? t(`plantAdvisor.identify.confidence.${data.identBucket}`)
                  : t('plantAdvisor.identify.confidence.unknown')}
                {' · '}
                {pct(data.identScore)}
              </Badge>
              {!data.hasConfirmedIdent && (
                <Badge variant="outline" className="text-[10px]">
                  {t('plantAdvisor.dashboard.notConfirmed')}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {[ident.family, ident.genus].filter(Boolean).join(' · ') || '—'}
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">{t('plantAdvisor.dashboard.facts.plantEmpty')}</div>
        )}
      </FactCard>

      {data.goal === 'diagnose' ? (
        <FactCard icon={<Bug className="h-3.5 w-3.5" />} title={t('plantAdvisor.dashboard.facts.problem')}>
          {diag ? (
            <>
              <div className="font-medium truncate">{diag.name || '—'}</div>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {diag.problem_type && (
                  <Badge variant="secondary" className="text-[10px]">
                    {diag.problem_type}
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px]">
                  {data.diagBucket ? t(`plantAdvisor.identify.confidence.${data.diagBucket}`) : '—'}
                  {' · '}
                  {pct(diag.score)}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {t('plantAdvisor.dashboard.chips.relevance')}:{' '}
                  {t(`plantAdvisor.dashboard.relevance.${diag.plant_relevance ?? 'unknown'}`)}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">{diag.provider}</div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">
              {t('plantAdvisor.dashboard.facts.problemEmpty')}
            </div>
          )}
        </FactCard>
      ) : (
        <FactCard icon={<Sprout className="h-3.5 w-3.5" />} title={t('plantAdvisor.dashboard.facts.profile')}>
          {data.profile ? (
            <>
              <div className="font-medium truncate">
                {data.profile.scientific_name || data.profile.common_name || '—'}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {[data.profile.family, data.profile.genus, data.profile.rank]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">
              {t('plantAdvisor.dashboard.facts.profileEmpty')}
            </div>
          )}
        </FactCard>
      )}

      <FactCard icon={<Eye className="h-3.5 w-3.5" />} title={t('plantAdvisor.dashboard.facts.checkNext')}>
        {data.whatToCheckNext.length > 0 ? (
          <ul className="space-y-0.5">
            {data.whatToCheckNext.map((c, i) => (
              <li key={i} className="text-xs text-foreground/80">
                • {c}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-muted-foreground">
            {t('plantAdvisor.dashboard.facts.checkNextEmpty')}
          </div>
        )}
      </FactCard>

      <FactCard
        icon={<Telescope className="h-3.5 w-3.5" />}
        title={t('plantAdvisor.dashboard.facts.research')}
      >
        {research ? (
          <>
            <Badge variant="outline" className="text-[10px] border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              {t('plantAdvisor.dashboard.researchReady')}
            </Badge>
            <div className="text-xs text-muted-foreground">
              {t('plantAdvisor.dashboard.facts.researchMeta', {
                count: research.sourceCount,
                date: format(new Date(research.updatedAt), 'PP'),
              })}
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">
            {t('plantAdvisor.dashboard.facts.researchEmpty')}
          </div>
        )}
      </FactCard>
    </div>
  );
}
