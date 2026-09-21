import type { PlantCaseGoal } from '@/hooks/usePlantCases';
import type { PlantCaseImage, PlantImageRole } from '@/hooks/usePlantCaseImages';
import type { VisualVerification, VisualSupport } from '@/lib/plantVisualVerification';

export type PhotoQualityStatus = 'good' | 'needs_more_photos' | 'insufficient';

export type PhotoSuggestionKey =
  | 'wholePlant'
  | 'leafCloseUp'
  | 'leafUpper'
  | 'leafUnderside'
  | 'flowerIfAvailable'
  | 'fruitSeedPod'
  | 'stemBarkIfWoody'
  | 'habitatContext'
  | 'affectedCloseUp'
  | 'healthyVsAffected'
  | 'stemFruitIfAffected'
  | 'visibleSymptomCloseUp'
  | 'soilBaseContext'
  | 'leafNewGrowth'
  | 'lightExposureContext'
  | 'harvestablePart'
  | 'densityContext'
  | 'qualityDefects'
  | 'waitForUpload';

export interface PhotoQualityFlags {
  hasImages: boolean;
  imageCount: number;
  hasWholePlant: boolean;
  hasLeaf: boolean;
  hasLeafUnderside: boolean;
  hasFlower: boolean;
  hasFruit: boolean;
  hasStemOrBark: boolean;
  hasAffectedArea: boolean;
  hasHealthyVsAffected: boolean;
  hasGoalCriticalPhotos: boolean;
}

export interface PhotoQualitySummary extends PhotoQualityFlags {
  goal: PlantCaseGoal | 'unspecified';
  status: PhotoQualityStatus;
  missingPhotoKeys: PhotoSuggestionKey[];
  visualMissingPhotos: string[];
  /** English fallback labels for AI/backend context; UI should localize keys. */
  missingPhotos: string[];
}

const LABELS: Record<PhotoSuggestionKey, string> = {
  wholePlant: 'Whole plant photo',
  leafCloseUp: 'Leaf close-up',
  leafUpper: 'Leaf upper side',
  leafUnderside: 'Leaf underside',
  flowerIfAvailable: 'Flower, if available',
  fruitSeedPod: 'Fruit, seed, or pod, if available',
  stemBarkIfWoody: 'Stem or bark, if woody',
  habitatContext: 'Habitat or growing context',
  affectedCloseUp: 'Affected part close-up',
  healthyVsAffected: 'Healthy and affected parts together',
  stemFruitIfAffected: 'Stem, cane, fruit, or flower if affected',
  visibleSymptomCloseUp: 'Insect, pustule, spot, or lesion close-up',
  soilBaseContext: 'Soil, base, pot, or bed context',
  leafNewGrowth: 'Leaf color and new growth',
  lightExposureContext: 'Light or exposure context',
  harvestablePart: 'Harvestable part, fruit, pod, or flower',
  densityContext: 'Plant density, row, or bed context',
  qualityDefects: 'Quality defects or maturity stage',
  waitForUpload: 'Wait for image upload to finish',
};

function hasRole(roles: PlantImageRole[], targets: PlantImageRole[]): boolean {
  return roles.some((r) => targets.includes(r));
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function cleanVisualSuggestions(items: string[] | undefined): string[] {
  return (items ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 160)
    .filter((s, i, a) => a.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
    .slice(0, 4);
}

function goalMissingKeys(goal: PlantCaseGoal | 'unspecified', flags: PhotoQualityFlags): PhotoSuggestionKey[] {
  const keys: PhotoSuggestionKey[] = [];
  if (!flags.hasWholePlant) keys.push('wholePlant');

  if (goal === 'diagnose') {
    if (!flags.hasAffectedArea) keys.push('affectedCloseUp');
    if (!flags.hasHealthyVsAffected) keys.push('healthyVsAffected');
    if (!flags.hasLeaf) keys.push('leafUpper');
    if (!flags.hasLeafUnderside) keys.push('leafUnderside');
    if (!flags.hasStemOrBark) keys.push('stemFruitIfAffected');
    keys.push('visibleSymptomCloseUp');
  } else if (goal === 'improve_growth') {
    if (!flags.hasAffectedArea) keys.push('soilBaseContext');
    if (!flags.hasLeaf) keys.push('leafNewGrowth');
    keys.push('lightExposureContext');
  } else if (goal === 'increase_income') {
    if (!flags.hasFruit && !flags.hasFlower) keys.push('harvestablePart');
    keys.push('densityContext');
    keys.push('qualityDefects');
  } else {
    if (!flags.hasLeaf) keys.push('leafCloseUp');
    if (!flags.hasFlower) keys.push('flowerIfAvailable');
    if (!flags.hasFruit) keys.push('fruitSeedPod');
    if (!flags.hasStemOrBark) keys.push('stemBarkIfWoody');
    keys.push('habitatContext');
  }

  return uniq(keys);
}

function criticalReady(goal: PlantCaseGoal | 'unspecified', flags: Omit<PhotoQualityFlags, 'hasGoalCriticalPhotos'>): boolean {
  if (!flags.hasImages) return false;
  if (goal === 'diagnose') return flags.hasWholePlant && flags.hasAffectedArea;
  if (goal === 'improve_growth') return flags.hasWholePlant && (flags.hasLeaf || flags.hasAffectedArea);
  if (goal === 'increase_income') return flags.hasWholePlant && (flags.hasFruit || flags.hasFlower || flags.hasAffectedArea);
  return flags.hasWholePlant && (flags.hasLeaf || flags.hasFlower || flags.hasFruit || flags.hasStemOrBark);
}

export function computePlantPhotoQuality({
  goal,
  images,
  visualVerification,
  lowIdentificationConfidence = false,
  lowDiagnosisConfidence = false,
}: {
  goal: PlantCaseGoal | null | undefined;
  images: Pick<PlantCaseImage, 'image_role' | 'upload_status' | 'mime_type'>[];
  visualVerification?: Pick<VisualVerification, 'visualSupport' | 'nextPhotoSuggestions'> | null;
  lowIdentificationConfidence?: boolean;
  lowDiagnosisConfidence?: boolean;
}): PhotoQualitySummary {
  const normalizedGoal = goal ?? 'unspecified';
  const activeImages = images.filter((img) => img.upload_status !== 'deleted' && img.upload_status !== 'deleting');
  const roles = activeImages.map((img) => img.image_role).filter(Boolean) as PlantImageRole[];
  const imageCount = activeImages.length;
  const hasImages = imageCount > 0;
  const hasWholePlant = hasRole(roles, ['whole_plant']);
  const hasLeaf = hasRole(roles, ['leaf']);
  const hasFlower = hasRole(roles, ['flower']);
  const hasFruit = hasRole(roles, ['fruit']);
  const hasStemOrBark = hasRole(roles, ['stem', 'bark']);
  const hasSpecificPart = hasRole(roles, ['leaf', 'flower', 'fruit', 'stem', 'bark', 'root', 'other']);
  const hasAffectedArea = normalizedGoal === 'diagnose' ? hasSpecificPart : hasRole(roles, ['root', 'other']);
  const hasLeafUnderside = false;
  const hasHealthyVsAffected = normalizedGoal === 'diagnose' && imageCount >= 2 && hasWholePlant && hasAffectedArea;
  const hasUploadInProgress = activeImages.some((img) => img.upload_status === 'uploading' || img.upload_status === 'staged');

  const baseFlags = {
    hasImages,
    imageCount,
    hasWholePlant,
    hasLeaf,
    hasLeafUnderside,
    hasFlower,
    hasFruit,
    hasStemOrBark,
    hasAffectedArea,
    hasHealthyVsAffected,
  };
  const hasGoalCriticalPhotos = criticalReady(normalizedGoal, baseFlags);
  const flags: PhotoQualityFlags = { ...baseFlags, hasGoalCriticalPhotos };
  const genericMissing = goalMissingKeys(normalizedGoal, flags);
  const missingPhotoKeys = uniq(hasUploadInProgress ? ['waitForUpload', ...genericMissing] : genericMissing);
  const visualMissingPhotos = cleanVisualSuggestions(visualVerification?.nextPhotoSuggestions);
  const visualSupport = visualVerification?.visualSupport;
  const lowProviderConfidence = normalizedGoal === 'diagnose' ? lowDiagnosisConfidence : lowIdentificationConfidence;

  let status: PhotoQualityStatus = 'good';
  if (!hasImages || visualSupport === 'not_plant') {
    status = 'insufficient';
  } else if (
    imageCount === 1 ||
    visualSupport === 'inconclusive' ||
    visualSupport === 'conflicts' ||
    !hasGoalCriticalPhotos ||
    (lowProviderConfidence && missingPhotoKeys.length > 0)
  ) {
    status = 'needs_more_photos';
  }

  const translatedFallbacks = missingPhotoKeys.map((k) => LABELS[k]);
  const missingPhotos = [...visualMissingPhotos, ...translatedFallbacks]
    .filter((s, i, a) => a.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
    .slice(0, 4);

  return {
    ...flags,
    goal: normalizedGoal,
    status,
    missingPhotoKeys: missingPhotoKeys.slice(0, 4),
    visualMissingPhotos,
    missingPhotos,
  };
}