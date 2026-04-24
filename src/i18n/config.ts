import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import srLatn from './locales/sr.json';
import {
  AVAILABLE_LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
  normalizeLanguageCode,
  type AvailableLanguageCode,
} from '@/lib/languages';

export const SUPPORTED_LANGUAGES = AVAILABLE_LANGUAGE_CODES;
export type SupportedLanguage = AvailableLanguageCode;

if (typeof window !== 'undefined') {
  const storedLanguage = window.localStorage.getItem('i18nextLng');
  const normalizedLanguage = normalizeLanguageCode(storedLanguage);
  if (storedLanguage && storedLanguage !== normalizedLanguage) {
    window.localStorage.setItem('i18nextLng', normalizedLanguage);
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      sr: { translation: srLatn },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    load: 'currentOnly',
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

export default i18n;
