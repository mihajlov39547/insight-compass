// Plant Advisor plan-aware limits.
// Backend must remain authoritative. These values are mirrored in the
// edge functions; keep them in sync.

export type PlantAdvisorPlan = 'free' | 'basic' | 'premium' | 'enterprise';

export interface PlantAdvisorLimits {
  maxPlantCases: number;
  maxImagesPerCase: number;
  maxImageBytes: number;
  maxTotalImages: number;
}

export const PLANT_ADVISOR_ACCEPTED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const FREE_LIMITS: PlantAdvisorLimits = {
  maxPlantCases: 3,
  maxImagesPerCase: 3,
  maxImageBytes: 5 * 1024 * 1024,
  maxTotalImages: 9,
};

const BASIC_LIMITS: PlantAdvisorLimits = {
  maxPlantCases: 10,
  maxImagesPerCase: 5,
  maxImageBytes: 8 * 1024 * 1024,
  maxTotalImages: 50,
};

const PREMIUM_LIMITS: PlantAdvisorLimits = {
  maxPlantCases: 50,
  maxImagesPerCase: 10,
  maxImageBytes: 20 * 1024 * 1024,
  maxTotalImages: 500,
};

export function getPlantAdvisorLimits(plan: PlantAdvisorPlan): PlantAdvisorLimits {
  if (plan === 'basic') return BASIC_LIMITS;
  if (plan === 'premium' || plan === 'enterprise') return PREMIUM_LIMITS;
  return FREE_LIMITS;
}

export type PlantLimitReason =
  | 'case_limit_reached'
  | 'image_limit_per_case_reached'
  | 'total_image_limit_reached'
  | 'file_too_large'
  | 'bad_mime'
  | 'ok';

export interface PlantLimitCheck {
  ok: boolean;
  reason: PlantLimitReason;
  limits: PlantAdvisorLimits;
}

export function canCreatePlantCase(
  plan: PlantAdvisorPlan,
  currentCaseCount: number,
): PlantLimitCheck {
  const limits = getPlantAdvisorLimits(plan);
  if (currentCaseCount >= limits.maxPlantCases) {
    return { ok: false, reason: 'case_limit_reached', limits };
  }
  return { ok: true, reason: 'ok', limits };
}

export function canUploadPlantImage(
  plan: PlantAdvisorPlan,
  imagesInCase: number,
  totalImages: number,
  fileSize: number,
  fileMime?: string,
): PlantLimitCheck {
  const limits = getPlantAdvisorLimits(plan);
  if (fileMime && !PLANT_ADVISOR_ACCEPTED_MIMES.includes(fileMime)) {
    return { ok: false, reason: 'bad_mime', limits };
  }
  if (fileSize > limits.maxImageBytes) {
    return { ok: false, reason: 'file_too_large', limits };
  }
  if (imagesInCase >= limits.maxImagesPerCase) {
    return { ok: false, reason: 'image_limit_per_case_reached', limits };
  }
  if (totalImages >= limits.maxTotalImages) {
    return { ok: false, reason: 'total_image_limit_reached', limits };
  }
  return { ok: true, reason: 'ok', limits };
}

export function formatPlantLimitReason(reason: PlantLimitReason): string {
  switch (reason) {
    case 'case_limit_reached':
      return 'plantAdvisor.limits.caseReached';
    case 'image_limit_per_case_reached':
      return 'plantAdvisor.limits.imagePerCaseReached';
    case 'total_image_limit_reached':
      return 'plantAdvisor.limits.totalImageReached';
    case 'file_too_large':
      return 'plantAdvisor.limits.fileTooLarge';
    case 'bad_mime':
      return 'plantAdvisor.limits.badMime';
    default:
      return '';
  }
}

export function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
