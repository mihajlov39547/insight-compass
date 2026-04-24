export const AVAILABLE_LANGUAGES = [
  {
    code: 'en',
    label: 'English',
    dateLocale: 'en-US',
    translationKey: 'languages.en',
  },
  {
    code: 'sr',
    label: 'Serbian (Latin)',
    dateLocale: 'sr-Latn',
    translationKey: 'languages.sr',
  },
] as const;

export type AvailableLanguageCode = typeof AVAILABLE_LANGUAGES[number]['code'];

export const AVAILABLE_LANGUAGE_CODES = AVAILABLE_LANGUAGES.map((language) => language.code);
export const DEFAULT_LANGUAGE: AvailableLanguageCode = 'en';

export function isAvailableLanguageCode(value: string): value is AvailableLanguageCode {
  return AVAILABLE_LANGUAGE_CODES.includes(value as AvailableLanguageCode);
}

export function normalizeLanguageCode(value?: string | null): AvailableLanguageCode {
  if (!value) return DEFAULT_LANGUAGE;
  const normalized = value.toLowerCase();
  if (normalized.startsWith('sr')) return 'sr';
  return isAvailableLanguageCode(normalized) ? normalized : DEFAULT_LANGUAGE;
}

export function getDateLocale(languageCode?: string | null): string {
  const code = normalizeLanguageCode(languageCode);
  return AVAILABLE_LANGUAGES.find((language) => language.code === code)?.dateLocale ?? 'en-US';
}
