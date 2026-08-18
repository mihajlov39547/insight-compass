import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, Images, Leaf, Sparkles, Sprout, Telescope } from 'lucide-react';
import { format } from 'date-fns';
import { useDeletePlantCase, type PlantCase } from '@/hooks/usePlantCases';
import { PlantImageUploader } from './PlantImageUploader';
import { PlantIdentificationSection } from './PlantIdentificationSection';
import { PlantDiagnosisDashboardContent } from './dashboard/PlantDiagnosisDashboardContent';
import { usePlantCaseImages } from '@/hooks/usePlantCaseImages';
import { PlantSpeciesProfileSection } from './PlantSpeciesProfileSection';
import { PlantGrowthGuidanceSection } from './PlantGrowthGuidanceSection';
import { PlantIncomeResearchSection } from './PlantIncomeResearchSection';
import { PlantResearchSection } from './PlantResearchSection';
import { PlantProblemResearchSection } from './PlantProblemResearchSection';
import { PlantCaseHero } from './dashboard/PlantCaseHero';
import { PlantCaseUncertaintyBanner } from './dashboard/PlantCaseUncertaintyBanner';
import { PlantCaseKeyFacts } from './dashboard/PlantCaseKeyFacts';
import { PlantCaseProgressTimeline } from './dashboard/PlantCaseProgressTimeline';
import { PlantCaseChatCta } from './dashboard/PlantCaseChatCta';
import { PlantDashboardSection } from './dashboard/PlantDashboardSection';
import { usePlantCaseDashboard, type ResearchArtifactSummary } from '@/hooks/usePlantCaseDashboard';

import { toast } from 'sonner';

interface Props {
  plantCase: PlantCase;
  onBack: () => void;
  onEdit: () => void;
  onOpenChat: () => void;
  onDeleted: () => void;
}

/** Strips the nested card chrome of legacy sections embedded in the new shells. */
const EMBED = '[&>*]:border-0 [&>*]:bg-transparent [&>*]:p-0 [&>*]:shadow-none';

export function PlantCaseDetail({ plantCase, onBack, onEdit, onOpenChat, onDeleted }: Props) {
  const { t } = useTranslation();
  const del = useDeletePlantCase();
  const { data: images = [] } = usePlantCaseImages(plantCase.id);
  const data = usePlantCaseDashboard(plantCase);

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

  const expand = t('plantAdvisor.dashboard.expand');
  const collapse = t('plantAdvisor.dashboard.collapse');

  const problemResearchFallback = [
    t('plantAdvisor.dashboard.diag.previewFallback1'),
    t('plantAdvisor.dashboard.diag.previewFallback2'),
    t('plantAdvisor.dashboard.diag.previewFallback3'),
  ];

  const researchSectionProps = (
    artifact: ResearchArtifactSummary | null,
    fallbackPreview?: string[],
  ) => ({
    statusLabel: artifact
      ? t('plantAdvisor.dashboard.researchReady')
      : t('plantAdvisor.dashboard.researchNotRun'),
    statusTone: (artifact ? 'ready' : 'pending') as 'ready' | 'pending',
    summary: artifact
      ? t('plantAdvisor.dashboard.facts.researchMeta', {
          count: artifact.sourceCount,
          date: format(new Date(artifact.updatedAt), 'PP'),
        })
      : undefined,
    preview: artifact
      ? artifact.previewBullets.length > 0
        ? artifact.previewBullets
        : fallbackPreview
      : undefined,
    expandLabel: t('plantAdvisor.dashboard.sections.researchExpand'),
    collapseLabel: collapse,
    defaultOpen: false,
  });


  const identificationSection = (
    <PlantDashboardSection
      icon={<Sparkles className="h-4 w-4" />}
      title={t('plantAdvisor.identify.sectionTitle')}
      statusLabel={
        data.hasConfirmedIdent
          ? data.lowIdentConfidence
            ? t('plantAdvisor.dashboard.status.lowConfidence')
            : t('plantAdvisor.dashboard.status.confirmed')
          : t('plantAdvisor.dashboard.notConfirmed')
      }
      statusTone={
        data.hasConfirmedIdent ? (data.lowIdentConfidence ? 'warning' : 'ready') : 'pending'
      }
      summary={
        data.topIdent
          ? [
              data.topIdent.common_name ||
                data.topIdent.scientific_name_without_author ||
                data.topIdent.scientific_name,
              data.identBucket ? t(`plantAdvisor.identify.confidence.${data.identBucket}`) : null,
              data.alternativesCount > 0
                ? t('plantAdvisor.dashboard.sections.altCount', { count: data.alternativesCount })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : t('plantAdvisor.dashboard.facts.plantEmpty')
      }
      expandLabel={expand}
      collapseLabel={collapse}
      defaultOpen={!data.hasConfirmedIdent}
    >
      <div className={EMBED}>
        <PlantIdentificationSection caseId={plantCase.id} images={images} />
      </div>
    </PlantDashboardSection>
  );

  const profileSection = (
    <PlantDashboardSection
      icon={<Sprout className="h-4 w-4" />}
      title={t('plantAdvisor.trefle.sectionTitle', 'Plant profile')}
      statusLabel={
        data.profile ? t('plantAdvisor.dashboard.status.ready') : t('plantAdvisor.dashboard.notRun')
      }
      statusTone={data.profile ? 'ready' : 'pending'}
      summary={
        data.profile
          ? [data.profile.scientific_name, data.profile.family, data.profile.genus, data.profile.rank]
              .filter(Boolean)
              .join(' · ')
          : t('plantAdvisor.dashboard.facts.profileEmpty')
      }
      expandLabel={expand}
      collapseLabel={collapse}
    >
      <div className={EMBED}>
        <PlantSpeciesProfileSection
          caseId={plantCase.id}
          hasConfirmedIdentification={!!plantCase.confirmed_identification_id}
        />
      </div>
    </PlantDashboardSection>
  );

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <PlantCaseHero
        plantCase={plantCase}
        data={data}
        onBack={onBack}
        onEdit={onEdit}
        onDelete={handleDelete}
        onOpenChat={onOpenChat}
      />

      <PlantCaseUncertaintyBanner data={data} />
      <PlantCaseKeyFacts data={data} />
      <PlantCaseProgressTimeline data={data} />

      <PlantDashboardSection
        icon={<Images className="h-4 w-4" />}
        title={t('plantAdvisor.dashboard.sections.images')}
        statusLabel={
          images.length > 0
            ? t('plantAdvisor.dashboard.sections.imageCount', { count: images.length })
            : t('plantAdvisor.dashboard.sections.noImages')
        }
        statusTone={images.length > 0 ? 'ready' : 'pending'}
        summary={t('plantAdvisor.dashboard.sections.imagesHelper')}
        expandLabel={t('plantAdvisor.dashboard.sections.manageImages')}
        collapseLabel={collapse}
        defaultOpen={images.length === 0}
      >
        <div className={EMBED}>
          <PlantImageUploader caseId={plantCase.id} />
        </div>
      </PlantDashboardSection>

      {plantCase.user_goal === 'diagnose' ? (
        <>
          {identificationSection}
          {profileSection}

          <PlantDashboardSection
            icon={<Bug className="h-4 w-4" />}
            title={t('plantAdvisor.dashboard.sections.diagnosis')}
            statusLabel={
              !plantCase.confirmed_identification_id
                ? t('plantAdvisor.dashboard.status.locked')
                : data.hasConfirmedDiag
                  ? data.lowDiagConfidence || data.unknownRelevance
                    ? t('plantAdvisor.dashboard.status.lowConfidence')
                    : t('plantAdvisor.dashboard.status.confirmed')
                  : t('plantAdvisor.dashboard.notConfirmed')
            }
            statusTone={
              !plantCase.confirmed_identification_id
                ? 'pending'
                : data.hasConfirmedDiag
                  ? data.lowDiagConfidence || data.unknownRelevance
                    ? 'warning'
                    : 'ready'
                  : 'pending'
            }
            summary={
              !plantCase.confirmed_identification_id
                ? t('plantAdvisor.diagnoseFlow.step2Locked')
                : data.topDiag
                  ? [
                      data.topDiag.name,
                      data.topDiag.problem_type,
                      t(`plantAdvisor.dashboard.relevance.${data.relevance}`),
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : t('plantAdvisor.dashboard.facts.problemEmpty')
            }
            expandLabel={expand}
            collapseLabel={collapse}
            defaultOpen={false}
          >
            {plantCase.confirmed_identification_id ? (
              <PlantDiagnosisDashboardContent
                caseId={plantCase.id}
                images={images}
                hasConfirmedIdentification={true}
                problemResearchReady={!!data.research.problem_research}
                whatToCheckNext={data.whatToCheckNext}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                {t('plantAdvisor.diagnoseFlow.step2Locked')}
              </div>
            )}
          </PlantDashboardSection>

          <PlantDashboardSection
            icon={<Telescope className="h-4 w-4" />}
            title={t('plantAdvisor.problemResearch.title')}
            {...researchSectionProps(data.research.problem_research ?? null)}
            preview={undefined}
          >
            <div className={EMBED}>
              <PlantProblemResearchSection
                plantCase={plantCase}
                hasConfirmedIdentification={!!plantCase.confirmed_identification_id}
              />
            </div>
          </PlantDashboardSection>
        </>
      ) : plantCase.user_goal === 'improve_growth' ? (
        <>
          {identificationSection}
          {profileSection}
          <PlantDashboardSection
            icon={<Leaf className="h-4 w-4" />}
            title={t('plantAdvisor.dashboard.sections.growth')}
            statusLabel={
              data.grounding
                ? t('plantAdvisor.dashboard.status.ready')
                : t('plantAdvisor.dashboard.notRun')
            }
            statusTone={data.grounding ? 'ready' : 'pending'}
            summary={t('plantAdvisor.dashboard.sections.growthHelper')}
            expandLabel={expand}
            collapseLabel={collapse}
            defaultOpen={!data.grounding}
          >
            <div className={EMBED}>
              <PlantGrowthGuidanceSection
                caseId={plantCase.id}
                hasConfirmedIdentification={!!plantCase.confirmed_identification_id}
              />
            </div>
          </PlantDashboardSection>
        </>
      ) : (
        <>
          {identificationSection}
          {profileSection}
          {plantCase.user_goal === 'identify' && (
            <>
              <PlantDashboardSection
                icon={<Leaf className="h-4 w-4" />}
                title={t('plantAdvisor.dashboard.sections.growth')}
                statusLabel={
                  data.grounding
                    ? t('plantAdvisor.dashboard.status.ready')
                    : t('plantAdvisor.dashboard.notRun')
                }
                statusTone={data.grounding ? 'ready' : 'pending'}
                summary={t('plantAdvisor.dashboard.sections.growthHelper')}
                expandLabel={expand}
                collapseLabel={collapse}
              >
                <div className={EMBED}>
                  <PlantGrowthGuidanceSection
                    caseId={plantCase.id}
                    hasConfirmedIdentification={!!plantCase.confirmed_identification_id}
                    helperKey="plantAdvisor.growth.helperIdentify"
                  />
                </div>
              </PlantDashboardSection>

              <PlantDashboardSection
                icon={<Telescope className="h-4 w-4" />}
                title={t('plantAdvisor.plantResearch.title')}
                {...researchSectionProps(data.research.research ?? null)}
              >
                <div className={EMBED}>
                  <PlantResearchSection
                    plantCase={plantCase}
                    hasConfirmedIdentification={!!plantCase.confirmed_identification_id}
                  />
                </div>
              </PlantDashboardSection>
            </>
          )}

          {plantCase.user_goal === 'increase_income' && (
            <PlantDashboardSection
              icon={<Telescope className="h-4 w-4" />}
              title={t('plantAdvisor.income.title')}
              {...researchSectionProps(data.research.income_research ?? null)}
            >
              <div className={EMBED}>
                <PlantIncomeResearchSection
                  plantCase={plantCase}
                  hasConfirmedIdentification={!!plantCase.confirmed_identification_id}
                />
              </div>
            </PlantDashboardSection>
          )}
        </>
      )}

      <PlantCaseChatCta data={data} onOpenChat={onOpenChat} />
    </div>
  );
}
