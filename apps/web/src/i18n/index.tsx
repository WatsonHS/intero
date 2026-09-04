import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getBootstrap, getMePreferences } from "../api.js";
import { usePilotOptional } from "../pilot/context.js";
import { enUS } from "./locales/en-US.js";
import { zhCN, type TranslationKey } from "./locales/zh-CN.js";

export type Locale = "zh-CN" | "en-US";
export type { TranslationKey } from "./locales/zh-CN.js";

const STORAGE_KEY = "intero:locale";
const dictionaries = { "zh-CN": zhCN, "en-US": enUS };

export function resolveInitialLocale(input: {
  stored?: string | null;
  languages?: readonly string[];
  server?: string | null;
}): Locale {
  if (input.server === "en-US" || input.server === "zh-CN") return input.server;
  if (input.stored === "en-US" || input.stored === "zh-CN") return input.stored;
  for (const language of input.languages ?? []) {
    const lower = language.toLowerCase();
    if (lower.startsWith("en")) return "en-US";
    if (lower.startsWith("zh")) return "zh-CN";
  }
  return "zh-CN";
}

interface I18nValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: TranslationKey, values?: Record<string, string | number>): string;
  formatDate(value: Date | string): string;
  formatTime(value: Date | string): string;
  formatRelative(value: Date | string): string;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

function navigatorLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return [...navigator.languages];
  return navigator.language ? [navigator.language] : [];
}

function initialLocale(): Locale {
  if (typeof window === "undefined") return "zh-CN";
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  return resolveInitialLocale({
    stored,
    languages: navigatorLanguages(),
  });
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
        const date = new Date(input);
        const day = new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(date);
        const weekday = new Intl.DateTimeFormat(locale, {
          weekday: "short",
        }).format(date);
        return `${day} · ${weekday}`;
      },
      formatTime(input) {
        return new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(input));
      },
      formatRelative(input) {
        const minutes = Math.round(
          (Date.now() - new Date(input).getTime()) / 60_000,
        );
        if (minutes < 0) {
          const futureMinutes = Math.abs(minutes);
          if (futureMinutes < 60) {
            return t("freshness.inMinutes", { count: futureMinutes });
          }
          const futureHours = Math.floor(futureMinutes / 60);
          if (futureHours < 24) {
            return t("freshness.inHours", { count: futureHours });
          }
          const futureDays = Math.floor(futureHours / 24);
          if (futureDays === 1) return t("freshness.tomorrow");
          return t("freshness.inDays", { count: futureDays });
        }
        if (minutes === 0) return t("freshness.now");
        if (minutes < 60) return t("freshness.minutesAgo", { count: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t("freshness.hoursAgo", { count: hours });
        const days = Math.floor(hours / 24);
        if (days === 1) return t("freshness.yesterday");
        return t("freshness.daysAgo", { count: days });
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

export function ServerLocaleSync() {
  const { setLocale } = useI18n();
  const pilot = usePilotOptional();
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const signedIn = Boolean(
    pilot?.bootstrap.data?.currentPrincipal ?? bootstrap.data?.currentPrincipal,
  );
  const preferences = useQuery({
    queryKey: ["me-preferences"],
    queryFn: ({ signal }) => getMePreferences(signal),
    enabled: signedIn,
  });
  const serverLocale =
    preferences.data?.locale ??
    pilot?.bootstrap.data?.currentPrincipal?.preferredLanguage ??
    bootstrap.data?.currentPrincipal?.preferredLanguage;
  useEffect(() => {
    if (serverLocale === "zh-CN" || serverLocale === "en-US") {
      setLocale(serverLocale);
    }
  }, [serverLocale, setLocale]);
  return null;
}
