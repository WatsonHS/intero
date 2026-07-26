import {
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import type { WorkstreamPhase } from "@intero/domain";
import { Fragment, type ReactNode, type UIEvent } from "react";

import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";
import { PHASE_META, initials, tintFor, type Tone } from "./utils.js";

/* ---------------------------------------------------------------------------
   Shared token-driven primitives.

   Everything here reads the kit through Tailwind utilities (bg-panel2,
   text-faint, rounded-card, …) — no per-view CSS and no raw hex. Views compose
   these instead of restating the same chip / avatar / row markup.
   --------------------------------------------------------------------------- */

export function cn(
  ...classes: Array<string | false | undefined | null>
): string {
  return classes.filter(Boolean).join(" ");
}

export const TONE_CLASSES: Record<
  Tone,
  { text: string; bg: string; dot: string; border: string }
> = {
  green: {
    text: "text-green",
    bg: "bg-green-soft",
    dot: "bg-green",
    border: "border-green",
  },
  amber: {
    text: "text-amber",
    bg: "bg-amber-soft",
    dot: "bg-amber",
    border: "border-amber",
  },
  danger: {
    text: "text-danger",
    bg: "bg-danger-soft",
    dot: "bg-danger",
    border: "border-danger",
  },
  faint: {
    text: "text-faint",
    bg: "bg-raise",
    dot: "bg-faint",
    border: "border-line2",
  },
  accent: {
    text: "text-accent-strong",
    bg: "bg-accent-soft",
    dot: "bg-accent-strong",
    border: "border-accent-strong",
  },
  cool: {
    text: "text-ink-muted",
    bg: "bg-raise",
    dot: "bg-faint",
    border: "border-line2",
  },
};

export function toneText(tone: Tone): string {
  return TONE_CLASSES[tone].text;
}

export function toneBg(tone: Tone): string {
  return TONE_CLASSES[tone].bg;
}

export function toneDot(tone: Tone): string {
  return TONE_CLASSES[tone].dot;
}

const AVATAR_SIZES = {
  xs: "h-[19px] w-[19px] text-[7.5px]",
  sm: "h-5 w-5 text-[8px]",
  md: "h-[26px] w-[26px] text-[9px]",
  lg: "h-[34px] w-[34px] text-[10.5px]",
  xl: "h-[52px] w-[52px] text-[15px]",
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

/** Person avatar. The tint is derived from the principal id, never from a name. */
export function Avatar({
  id,
  name,
  size = "md",
  className,
}: {
  id: string;
  name?: string | undefined;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-[650] text-on-tint",
        AVATAR_SIZES[size],
        className,
      )}
      style={{ background: tintFor(id) }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

/** Two overlapping avatars — the two sides of a coordination branch. */
export function AvatarPair({
  left,
  right,
  size = "xs",
}: {
  left: { id: string; name?: string | undefined };
  right: { id: string; name?: string | undefined };
  size?: AvatarSize;
}) {
  return (
    <span className="flex items-center">
      <Avatar id={left.id} name={left.name} size={size} />
      <Avatar
        id={right.id}
        name={right.name}
        size={size}
        className="-ml-[5px] ring-1 ring-panel"
      />
    </span>
  );
}

/** Uppercase micro-heading used above every side-rail and list section. */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-[10.5px] font-[650] tracking-[0.08em] text-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Status pill: tone-tinted background, optional leading dot. */
export function StatusPill({
  tone,
  children,
  dot = false,
  pulse = false,
  size = "md",
  className,
}: {
  tone: Tone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const classes = TONE_CLASSES[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-pill font-[620]",
        size === "sm" ? "px-2 py-[3px] text-[9px]" : "px-2.5 py-1 text-[10px]",
        classes.text,
        classes.bg,
        className,
      )}
    >
      {dot ? (
        <span
          className={cn(
            "h-[5px] w-[5px] rounded-full",
            classes.dot,
            pulse ? "animate-dot-pulse" : undefined,
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

/** Work State phase chip — the one place phase vocabulary is rendered. */
export function PhaseChip({
  phase,
  size = "sm",
  animate = false,
}: {
  phase: WorkstreamPhase;
  size?: "sm" | "md";
  animate?: boolean;
}) {
  const { t } = useI18n();
  const meta = PHASE_META[phase];
  return (
    <StatusPill
      // Re-keying on phase replays the pulse whenever the phase actually moves.
      key={animate ? phase : "static"}
      tone={meta.tone}
      dot
      pulse={meta.tone === "danger"}
      size={size}
      {...(animate ? { className: "animate-pill-pulse" } : {})}
    >
      {t(`phase.${phase}` as TranslationKey)}
    </StatusPill>
  );
}

/** Monospace metadata text (ids, timestamps, counts). */
export function Meta({
  children,
  tone = "faint",
  className,
}: {
  children: ReactNode;
  tone?: "faint" | "muted" | "amber" | "danger" | "green";
  className?: string;
}) {
  const color =
    tone === "muted"
      ? "text-ink-muted"
      : tone === "amber"
        ? "text-amber"
        : tone === "danger"
          ? "text-danger"
          : tone === "green"
            ? "text-green"
            : "text-faint";
  return (
    <span className={cn("font-mono text-[10px]", color, className)}>
      {children}
    </span>
  );
}

/** Thin progress meter. `grow` plays the bar-grow entrance once. */
export function Meter({
  percent,
  tone = "green",
  width = 34,
  grow = false,
}: {
  percent: number;
  tone?: Tone;
  width?: number;
  grow?: boolean;
}) {
  return (
    <span
      className="relative inline-block h-1 shrink-0 overflow-hidden rounded-[2px] bg-raise"
      style={{ width }}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 origin-left",
          TONE_CLASSES[tone].dot,
          grow ? "animate-bar-grow" : undefined,
        )}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </span>
  );
}

/**
 * Label/value row used by every narrative block (已完成 · 证据 · 下一步).
 * `labelWidth` keeps the labels aligned in a single grid column.
 */
export function NarrativeGrid({
  rows,
  labelWidth = 54,
  className,
}: {
  rows: Array<{
    label: string;
    value: ReactNode;
    tone?: "default" | "danger";
    mono?: boolean;
  }>;
  labelWidth?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid items-start gap-y-2 gap-x-3", className)}
      style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)` }}
    >
      {rows.map((row) => (
        <Fragment key={row.label}>
          <span
            className={cn(
              "pt-[2px] text-[10px] font-[650] tracking-[0.06em]",
              row.tone === "danger" ? "text-danger" : "text-faint",
            )}
          >
            {row.label}
          </span>
          <span
            className={cn(
              "leading-[1.6] [text-wrap:pretty]",
              row.mono ? "font-mono text-[11px]" : "text-[12.5px]",
              row.tone === "danger" ? "text-danger" : "text-ink",
            )}
          >
            {row.value}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Rounded filter chip; `active` fills it with the accent wash. */
export function FilterChip({
  active,
  onClick,
  children,
  leading,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border text-[11px]",
        leading ? "pl-1 pr-2.5" : "px-2.5",
        active
          ? "border-accent-strong bg-accent-soft text-accent-strong"
          : "border-line2 bg-transparent text-ink-muted hover:border-accent-strong",
        className,
      )}
    >
      {leading}
      {children}
    </button>
  );
}

/** Segmented control for mutually exclusive view modes. */
export function SegmentedControl<Id extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: Array<{ id: Id; label: ReactNode; badge?: ReactNode }>;
  value: Id;
  onChange: (id: Id) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex rounded-[10px] bg-raise p-[3px]", className)}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          aria-pressed={value === item.id}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-quiet border-0 px-3 text-[11.5px] font-[600]",
            value === item.id
              ? "bg-panel2 text-ink"
              : "bg-transparent text-ink-muted hover:text-ink",
          )}
        >
          {item.label}
          {item.badge === undefined ? null : (
            <span className="font-mono text-[9.5px] text-faint">
              {item.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Left list pane: fixed-width column with a static header, a scrolling body,
 * and a footer that carries paging affordances.
 */
export function ListPane({
  title,
  count,
  lede,
  filters,
  action,
  children,
  footer,
  onScroll,
  width = 312,
}: {
  title: ReactNode;
  count?: ReactNode;
  lede?: ReactNode;
  filters?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  width?: number;
}) {
  return (
    <div
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-r border-line bg-panel"
      style={{ width }}
    >
      <div className="px-5 pb-3.5 pt-6">
        <div className="flex items-baseline gap-2.5">
          <strong className="text-[13.5px] font-[650]">{title}</strong>
          {count === undefined ? null : (
            <span className="font-mono text-[10.5px] text-faint">{count}</span>
          )}
          {action ? <span className="ml-auto">{action}</span> : null}
        </div>
        {lede ? (
          <p className="mt-2.5 text-[11px] leading-[1.6] text-faint [text-wrap:pretty]">
            {lede}
          </p>
        ) : null}
        {filters ? (
          <div className="mt-3.5 flex flex-wrap gap-1.5">{filters}</div>
        ) : null}
      </div>
      <div
        className="min-h-0 overflow-auto px-3 pb-4"
        {...(onScroll ? { onScroll } : {})}
      >
        {children}
      </div>
      {footer ? (
        <div className="flex items-center gap-2.5 border-t border-line px-4 py-[11px]">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/** One selectable row inside a ListPane. */
export function ListRow({
  selected,
  onClick,
  children,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      {...(testId ? { "data-testid": testId } : {})}
      className={cn(
        "mb-[3px] grid w-full cursor-pointer gap-2 rounded-[11px] border-0 px-3.5 py-[13px] text-left text-ink",
        selected ? "bg-sel" : "bg-transparent hover:bg-hover-wash",
      )}
    >
      {children}
    </button>
  );
}

/** "load more" affordance shared by the coordination and spec list panes. */
export function LoadMore({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[11px] text-accent-strong hover:underline"
    >
      <CaretDownIcon size={12} />
      {label}
    </button>
  );
}

/** Prev/next pager with an "n–m / total" readout. */
export function Pager({
  page,
  pages,
  label,
  onPrevious,
  onNext,
}: {
  page: number;
  pages: number;
  label: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPrevious}
        disabled={page <= 0}
        aria-label={t("general.previousPage")}
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-quiet border border-line2 bg-transparent text-ink hover:border-accent-strong disabled:cursor-default disabled:text-faint disabled:hover:border-line2"
      >
        <CaretLeftIcon size={12} />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= pages - 1}
        aria-label={t("general.nextPage")}
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-quiet border border-line2 bg-transparent text-ink hover:border-accent-strong disabled:cursor-default disabled:text-faint disabled:hover:border-line2"
      >
        <CaretRightIcon size={12} />
      </button>
      <span className="ml-auto font-mono text-[10.5px] text-faint">
        {label}
      </span>
    </div>
  );
}

/** Dashed empty slot used inside lists and trees. */
export function EmptySlot({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-inset border border-dashed border-line2 p-[22px] text-[11.5px] leading-[1.6] text-ink-muted">
      {children}
    </div>
  );
}

/** Vertical timeline rail; children are <TimelineEntry> nodes. */
export function Timeline({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative pl-[26px]", className)}>
      <span className="absolute bottom-6 left-[6px] top-2 w-px bg-line2" />
      {children}
    </div>
  );
}

export function TimelineEntry({
  tone = "accent",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <div className="relative pb-6">
      <span
        className={cn(
          "absolute -left-[26px] top-[5px] h-[13px] w-[13px] rounded-full border-2 bg-bg",
          TONE_CLASSES[tone].border,
        )}
      />
      {children}
    </div>
  );
}

/** Column-header strip for the table-shaped views. */
export function TableHead({
  columns,
  template,
}: {
  columns: string[];
  template: string;
}) {
  return (
    <div
      className="grid gap-3.5 border-b border-line2 px-3 pb-2.5 text-[10.5px] tracking-[0.08em] text-faint"
      style={{ gridTemplateColumns: template }}
    >
      {columns.map((column) => (
        <span key={column}>{column}</span>
      ))}
    </div>
  );
}

/** Search field shaped like a pill, matching the design's filter bars. */
export function SearchField({
  value,
  onChange,
  placeholder,
  width = 168,
  icon,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  width?: number;
  icon: ReactNode;
}) {
  return (
    <label className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-line2 bg-panel2 px-3">
      {icon}
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="border-0 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-faint"
        style={{ width }}
      />
    </label>
  );
}
