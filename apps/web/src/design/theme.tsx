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

/** The resolved appearance actually applied to the document. */
export type ThemeMode = "dark" | "light";
/** What the user chose. "system" defers to the OS and keeps tracking it. */
export type ThemePreference = ThemeMode | "system";

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
  /** Resolved appearance — what is on screen right now. */
  mode: ThemeMode;
  /** The stored choice, which may be "system". */
  preference: ThemePreference;
  accent: string;
  reduceMotion: boolean;
  /** Pins an explicit appearance, leaving "system". */
  setMode(mode: ThemeMode): void;
  setPreference(preference: ThemePreference): void;
  setAccent(hex: string): void;
  setReduceMotion(value: boolean): void;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

interface StoredTheme {
  preference?: ThemePreference;
  accent?: string;
  reduceMotion?: boolean;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemMode(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function readStored(): StoredTheme {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredTheme & { mode?: unknown };
    // Installs written before "system" existed stored a bare `mode`. That was
    // an explicit choice at the time, so it migrates to an explicit
    // preference rather than silently switching the user to system.
    const legacy =
      parsed.mode === "dark" || parsed.mode === "light"
        ? (parsed.mode as ThemeMode)
        : undefined;
    const preference =
      parsed.preference === "system" ||
      parsed.preference === "dark" ||
      parsed.preference === "light"
        ? parsed.preference
        : legacy;
    return {
      ...(preference ? { preference } : {}),
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
  const [preference, setPreference] = useState<ThemePreference>(
    stored.preference ?? "system",
  );
  const [systemPreferred, setSystemPreferred] = useState<ThemeMode>(systemMode);
  const [accent, setAccent] = useState<string>(stored.accent ?? DEFAULT_ACCENT);
  const [reduceMotion, setReduceMotion] = useState<boolean>(
    stored.reduceMotion ?? false,
  );
  const mode: ThemeMode =
    preference === "system" ? systemPreferred : preference;

  // Track the OS setting even while an explicit mode is pinned, so switching
  // back to "system" applies the current value without a reload.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(DARK_QUERY);
    const sync = (event: MediaQueryListEvent) =>
      setSystemPreferred(event.matches ? "dark" : "light");
    query.addEventListener("change", sync);
    setSystemPreferred(query.matches ? "dark" : "light");
    return () => query.removeEventListener("change", sync);
  }, []);

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
        JSON.stringify({ preference, accent, reduceMotion }),
      );
    } catch {
      // The in-memory theme still applies when device storage is unavailable.
    }
  }, [preference, accent, reduceMotion]);

  const setModeStable = useCallback(
    (next: ThemeMode) => setPreference(next),
    [],
  );
  const setPreferenceStable = useCallback(
    (next: ThemePreference) => setPreference(next),
    [],
  );
  const setAccentStable = useCallback((next: string) => setAccent(next), []);
  const setReduceMotionStable = useCallback(
    (next: boolean) => setReduceMotion(next),
    [],
  );

  const value = useMemo<ThemeValue>(
    () => ({
      mode,
      preference,
      accent,
      reduceMotion,
      setMode: setModeStable,
      setPreference: setPreferenceStable,
      setAccent: setAccentStable,
      setReduceMotion: setReduceMotionStable,
    }),
    [
      mode,
      preference,
      accent,
      reduceMotion,
      setModeStable,
      setPreferenceStable,
      setAccentStable,
      setReduceMotionStable,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}
