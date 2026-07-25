import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Runtime bridge for the Intero design tokens (packages/ui/src/tokens.css).
 *
 * All color derivation lives in CSS: the provider only toggles the
 * `.theme-light` / `.motion-reduced` classes on <html>, sets the single
 * customizable `--intero-accent-base` property, and persists the choice.
 */

export type ThemeMode = "dark" | "light";

export interface AccentOption {
  hex: string;
  name: string;
}

export const ACCENTS: AccentOption[] = [
  { hex: "#d98b4a", name: "琥珀 amber" },
  { hex: "#c4674a", name: "陶土 terracotta" },
  { hex: "#6f9e78", name: "苔绿 sage" },
  { hex: "#6d87c9", name: "蓝墨 ink blue" },
];

const DEFAULT_ACCENT = ACCENTS[0]!.hex;
const STORAGE_KEY = "intero:theme:v1";

export function lum(hex: string): number {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

interface ThemeValue {
  mode: ThemeMode;
  accent: string;
  reduceMotion: boolean;
  setMode(mode: ThemeMode): void;
  setAccent(hex: string): void;
  setReduceMotion(value: boolean): void;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

interface StoredTheme {
  mode?: ThemeMode;
  accent?: string;
  reduceMotion?: boolean;
}

function readStored(): StoredTheme {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredTheme;
    return {
      ...(parsed.mode === "dark" || parsed.mode === "light"
        ? { mode: parsed.mode }
        : {}),
      ...(typeof parsed.accent === "string" &&
      /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(parsed.accent)
        ? { accent: parsed.accent }
        : {}),
      ...(typeof parsed.reduceMotion === "boolean"
        ? { reduceMotion: parsed.reduceMotion }
        : {}),
    };
  } catch {
    return {};
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const stored = useMemo(readStored, []);
  const [mode, setMode] = useState<ThemeMode>(stored.mode ?? "dark");
  const [accent, setAccent] = useState<string>(stored.accent ?? DEFAULT_ACCENT);
  const [reduceMotion, setReduceMotion] = useState<boolean>(
    stored.reduceMotion ?? false,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("theme-light", mode === "light");
    root.classList.toggle("motion-reduced", reduceMotion);
    root.style.setProperty("--intero-accent-base", accent);
  }, [mode, accent, reduceMotion]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mode, accent, reduceMotion }),
      );
    } catch {
      // The in-memory theme still applies when device storage is unavailable.
    }
  }, [mode, accent, reduceMotion]);

  const setModeStable = useCallback((next: ThemeMode) => setMode(next), []);
  const setAccentStable = useCallback((next: string) => setAccent(next), []);
  const setReduceMotionStable = useCallback(
    (next: boolean) => setReduceMotion(next),
    [],
  );

  const value = useMemo<ThemeValue>(
    () => ({
      mode,
      accent,
      reduceMotion,
      setMode: setModeStable,
      setAccent: setAccentStable,
      setReduceMotion: setReduceMotionStable,
    }),
    [
      mode,
      accent,
      reduceMotion,
      setModeStable,
      setAccentStable,
      setReduceMotionStable,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}
