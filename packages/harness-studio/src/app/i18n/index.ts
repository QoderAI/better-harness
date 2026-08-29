import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources.js";

export const SUPPORTED_LANGUAGES = ["en", "zh-CN"] as const;
export type StudioLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const LANGUAGE_STORAGE_KEY = "harness-studio-language";

export function isStudioLanguage(value: string | null | undefined): value is StudioLanguage {
  return value === "en" || value === "zh-CN";
}

/** Browser preference wins only when no language was persisted by the user. */
export function detectStudioLanguage(): StudioLanguage {
  try {
    const stored = globalThis.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isStudioLanguage(stored)) return stored;
  } catch {
    // Storage unavailable: fall through to browser detection.
  }
  const browserLanguage = globalThis.navigator?.language?.toLowerCase() ?? "";
  return browserLanguage.startsWith("zh") ? "zh-CN" : "en";
}

export function persistStudioLanguage(language: StudioLanguage): void {
  try {
    globalThis.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The chosen language still applies for this page session.
  }
}

export const studioI18n = i18n.createInstance();

/**
 * Synchronous bootstrap: resources are bundled modules, so translation keys
 * are resolvable immediately after init without a suspense boundary or an
 * async resource fetch.
 */
export function initStudioI18n(): StudioLanguage {
  const language = detectStudioLanguage();
  studioI18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return language;
}

/** Switch the active Studio language and keep the choice for the next visit. */
export function switchStudioLanguage(language: StudioLanguage): void {
  persistStudioLanguage(language);
  void studioI18n.changeLanguage(language);
  document.documentElement.lang = language;
}

/** Locale tag for `Intl` constructors: follows the active Studio language. */
export function studioLocale(): string {
  return studioI18n.resolvedLanguage ?? studioI18n.language ?? "en";
}