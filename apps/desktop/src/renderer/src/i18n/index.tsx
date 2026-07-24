import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { enUS } from "./locales/en-US.js";
import { zhCN, type TranslationKey } from "./locales/zh-CN.js";

export type Locale = "zh-CN" | "en-US";

const STORAGE_KEY = "intero:locale";
const dictionaries = { "zh-CN": zhCN, "en-US": enUS };

interface I18nValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: TranslationKey, values?: Record<string, string | number>): string;
  formatDate(value: Date | string): string;
  formatTime(value: Date | string): string;
  formatRelative(value: Date | string): string;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

function initialLocale(): Locale {
  if (typeof window === "undefined") return "zh-CN";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "en-US" || stored === "zh-CN" ? stored : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The in-memory selection still works when device storage is unavailable.
    }
    setLocaleState(next);
  }, []);
  const t = useCallback(
    (key: TranslationKey, values: Record<string, string | number> = {}) =>
      Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        dictionaries[locale][key] as string,
      ),
    [locale],
  );
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t,
      formatDate(input) {
        return new Intl.DateTimeFormat(locale, {
          weekday: "long",
          month: "long",
          day: "numeric",
        }).format(new Date(input));
      },
      formatTime(input) {
        return new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(input));
      },
      formatRelative(input) {
        const minutes = Math.max(
          0,
          Math.round((Date.now() - new Date(input).getTime()) / 60_000),
        );
        return minutes === 0
          ? t("freshness.now")
          : t("freshness.minutesAgo", { count: minutes });
      },
    }),
    [locale, setLocale, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider.");
  return context;
}
