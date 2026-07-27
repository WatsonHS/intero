import {
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { WorkstreamPhase } from "@intero/domain";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { createPortal } from "react-dom";

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
  disabled = false,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
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
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  leading?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      {...(testId ? { "data-testid": testId } : {})}
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
  header,
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
  /** Slot above the title — the scope this list belongs to. */
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  width?: number;
}) {
  return (
    // The explicit `minmax(0,…)` column is load-bearing: grid rows size to
    // their min-content by default, so one unshrinkable child (a long project
    // name, say) would widen the header past the pane and spill its contents
    // over whatever sits in the next column.
    <div
      className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] border-r border-line bg-panel"
      style={{ width }}
    >
      <div className="min-w-0 px-5 pb-3.5 pt-5">
        {header}
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

/**
 * Masonry wall. Cards whose height varies a lot (one person has one workstream,
 * the next has five) leave a void under every short card in a fixed grid row,
 * and CSS multicol balances them into a fraction of the available width. So the
 * columns are built explicitly: measure the container, derive the column count,
 * and deal the items round-robin so every column stays the same length.
 */
export function MasonryColumns<T>({
  items,
  keyOf,
  renderItem,
  minColumnWidth = 330,
  gap = 12,
  className,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  minColumnWidth?: number;
  gap?: number;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      setColumnCount(
        Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap))),
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [gap, minColumnWidth]);

  // Never open more columns than there are cards, or the trailing empty ones
  // reintroduce exactly the dead space this component exists to remove.
  const used = Math.max(1, Math.min(columnCount, items.length));
  const columns: Array<Array<{ item: T; index: number }>> = Array.from(
    { length: used },
    () => [],
  );
  items.forEach((item, index) => {
    columns[index % used]!.push({ item, index });
  });

  return (
    <div
      ref={container}
      className={cn("flex items-start", className)}
      style={{ gap }}
    >
      {columns.map((column, columnIndex) => (
        <div
          key={columnIndex}
          className="flex min-w-0 flex-1 flex-col"
          style={{ gap }}
        >
          {column.map(({ item, index }) => (
            <Fragment key={keyOf(item)}>{renderItem(item, index)}</Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}

const MENU_MIN_WIDTH = 176;
const MENU_ROW_HEIGHT = 30;
const MENU_MAX_ROWS = 8;

/**
 * A dropdown built from the token layer instead of the platform's native
 * <select>, whose popup is drawn by the OS and ignores our surfaces, type, and
 * theme entirely.
 *
 * The trigger renders whatever chip the caller passes, so a card keeps its own
 * typography; the menu is portalled to the body and positioned against the
 * trigger, because cards live inside scrolling panes that would otherwise clip
 * an absolutely-positioned popup. Keyboard and ARIA behaviour is implemented
 * explicitly to match what the native control gave us for free.
 */
export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  label,
  children,
  className,
  disabled = false,
}: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string; leading?: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    minWidth: number;
  }>();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const menuId = useId();

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const height =
      Math.min(options.length, MENU_MAX_ROWS) * MENU_ROW_HEIGHT + 10;
    const below = window.innerHeight - rect.bottom;
    // Flip above the trigger when the menu would run off the bottom.
    const top =
      below < height && rect.top > below
        ? rect.top - height - 6
        : rect.bottom + 6;
    const width = Math.max(rect.width, MENU_MIN_WIDTH);
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - width - 8),
    );
    setPosition({ top, left, minWidth: width });
  }, [options.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    // A scroll or resize invalidates the measured position; closing is both
    // simpler and less jarring than chasing the trigger around.
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.focus();
  }, [open, position]);

  function openMenu() {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function commit(index: number) {
    const option = options[index];
    if (option && option.id !== value) onChange(option.id);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        {...(open ? { "aria-controls": menuId } : {})}
        draggable={false}
        onDragStart={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (disabled) return;
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            if (!disabled) openMenu();
          }
        }}
        className={cn(
          "inline-flex cursor-pointer items-center rounded-pill border-0 bg-transparent p-0 outline-offset-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-strong disabled:cursor-default disabled:opacity-55",
          className,
        )}
      >
        {children}
      </button>

      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="listbox"
              aria-label={label}
              aria-activedescendant={`${menuId}-${activeIndex}`}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  triggerRef.current?.focus();
                } else if (event.key === "Tab") {
                  event.preventDefault();
                  const trigger = triggerRef.current;
                  setOpen(false);
                  if (trigger) {
                    focusAdjacentControl(trigger, event.shiftKey ? -1 : 1);
                  }
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => (index + 1) % options.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex(
                    (index) => (index - 1 + options.length) % options.length,
                  );
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setActiveIndex(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setActiveIndex(options.length - 1);
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  commit(activeIndex);
                }
              }}
              style={{
                top: position.top,
                left: position.left,
                minWidth: position.minWidth,
              }}
              className="fixed z-50 max-h-[280px] overflow-auto rounded-inset border border-line2 bg-panel2 p-1 outline-none animate-message-enter"
            >
              {options.map((option, index) => (
                <div
                  key={option.id}
                  id={`${menuId}-${index}`}
                  role="option"
                  aria-selected={option.id === value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-quiet px-2.5 py-1.5 text-[11.5px]",
                    index === activeIndex
                      ? "bg-hover-wash text-ink"
                      : "text-ink-muted",
                  )}
                >
                  {option.leading}
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  {option.id === value ? (
                    <CheckIcon size={12} className="text-accent-strong" />
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function focusAdjacentControl(origin: HTMLElement, direction: -1 | 1) {
  const controls = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
  const current = controls.indexOf(origin);
  controls[current + direction]?.focus();
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

/**
 * Labelled single-line input — the kit's field face, so the governance forms
 * do not each restate the same border, height and focus treatment.
 */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
  disabled = false,
  onEnter,
  className,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "url";
  /** Monospace face for addresses and identifiers. */
  mono?: boolean;
  disabled?: boolean;
  onEnter?: () => void;
  className?: string;
  testId?: string;
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <SectionLabel>{label}</SectionLabel>
      <input
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
        {...(testId ? { "data-testid": testId } : {})}
        className={cn(
          "h-8 rounded-btn border border-line bg-panel px-2.5 text-ink outline-none",
          "placeholder:text-faint focus:border-accent-strong disabled:opacity-50",
          mono ? "font-mono text-[11.5px]" : "text-[12px]",
        )}
      />
    </label>
  );
}

const MARK_SIZES = {
  sm: "h-[22px] w-[22px] rounded-quiet text-[9px]",
  md: "h-[28px] w-[28px] rounded-[9px] text-[10px]",
  lg: "h-8 w-8 rounded-[9px] text-[10px]",
} as const;

/**
 * Square counterpart to <Avatar> for the things people belong to — orgs, teams,
 * projects. Rounded-square keeps places visually distinct from people, and the
 * tint derives from the id so the same team reads the same colour everywhere.
 */
export function ScopeMark({
  id,
  label,
  size = "md",
  filled = false,
  className,
}: {
  id: string;
  label: string;
  size?: keyof typeof MARK_SIZES;
  /** Solid tint (on-tint text) instead of the washed tint-on-dark treatment. */
  filled?: boolean;
  className?: string;
}) {
  const tint = tintFor(id);
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center font-mono font-[650] uppercase",
        MARK_SIZES[size],
        filled ? "text-on-tint" : undefined,
        className,
      )}
      style={
        filled
          ? { background: tint }
          : {
              background: `color-mix(in srgb, ${tint} 18%, transparent)`,
              color: tint,
            }
      }
    >
      {initials(label)}
    </span>
  );
}

/**
 * Anchored floating panel. Renders through a portal above a click-catching
 * scrim so the trigger stays in the titlebar's drag region without the panel
 * inheriting its clipping.
 */
export function Popover({
  anchor,
  onClose,
  width = 332,
  align = "start",
  children,
  className,
}: {
  anchor: DOMRect | undefined;
  onClose: () => void;
  width?: number;
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!anchor) return null;
  const left =
    align === "end"
      ? Math.max(
          8,
          Math.min(anchor.right - width, window.innerWidth - width - 8),
        )
      : Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  return createPortal(
    <>
      <span
        className="fixed inset-0 z-40"
        onClick={onClose}
        data-testid="popover-scrim"
      />
      <div
        role="dialog"
        className={cn(
          "animate-card-enter fixed z-50 rounded-container border border-line2 bg-panel2 p-[9px]",
          "shadow-[0_26px_64px_rgba(0,0,0,0.38)]",
          className,
        )}
        style={{ left, top: anchor.bottom + 6, width }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/** Centred modal over a scrim. Header / scrolling body / footer. */
export function Modal({
  title,
  onClose,
  width = 470,
  footer,
  head,
  children,
}: {
  title: string;
  onClose: () => void;
  width?: number;
  footer?: ReactNode;
  /** Fixed area under the title that does not scroll with the body. */
  head?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="animate-view-enter fixed inset-0 z-[60] grid place-items-center bg-black/45">
      <span className="absolute inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={[
          "animate-card-enter relative grid max-h-[80vh] grid-rows-[auto_minmax(0,1fr)_auto]",
          "rounded-[18px] border border-line2 bg-panel2 px-[22px] pb-4 pt-5",
          "shadow-[0_40px_90px_rgba(0,0,0,0.5)]",
        ].join(" ")}
        style={{ width }}
      >
        <div>
          <div className="flex items-center gap-2.5">
            <strong className="text-[15px] font-[620] tracking-[-0.02em]">
              {title}
            </strong>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-auto grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-quiet border-0 bg-transparent text-faint hover:bg-hover-wash hover:text-ink"
            >
              <XIcon size={14} />
            </button>
          </div>
          {head}
        </div>
        <div className="-mx-1.5 mt-2 min-h-0 overflow-auto px-1.5">
          {children}
        </div>
        {footer ? (
          <div className="mt-3.5 flex items-center gap-2 border-t border-line pt-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/** Underlined tab strip. */
export function Tabs<Id extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: Id;
  onChange: (value: Id) => void;
  items: ReadonlyArray<{ id: Id; label: string; icon?: ReactNode }>;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 border-b border-line", className)}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-2 border-0 border-b-2 bg-transparent px-3.5 py-[11px] text-[12.5px] font-[560]",
              active
                ? "border-b-accent-strong text-ink"
                : "border-b-transparent text-faint hover:text-ink",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Checkbox drawn from the kit rather than the browser default, so it carries
 * the accent instead of the OS blue. The native input stays underneath for
 * keyboard and assistive-technology support.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  className,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <label
      className={cn(
        "group inline-flex items-center gap-2.5",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        {...(testId ? { "data-testid": testId } : {})}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border transition-colors duration-150",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-accent-strong peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-panel2",
          checked
            ? "border-accent-strong bg-accent-strong text-on-accent"
            : "border-line2 bg-transparent text-transparent group-hover:border-accent-strong",
        )}
      >
        <CheckIcon size={10} weight="bold" />
      </span>
      <span className="min-w-0 text-[12px] text-ink">{label}</span>
    </label>
  );
}

/** Pill switch used by the policy rows. Purely presentational. */
export function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-6 w-[42px] items-center rounded-pill p-[3px] transition-colors duration-200",
        on ? "justify-end bg-accent-strong" : "justify-start bg-raise",
      )}
    >
      <span
        className={cn(
          "h-[18px] w-[18px] rounded-full",
          on ? "bg-on-accent" : "bg-faint",
        )}
      />
    </span>
  );
}

/**
 * Radio-shaped card for a mutually exclusive policy choice. `locked` marks the
 * options a tighter parent policy has taken off the table.
 */
export function OptionCard({
  selected,
  title,
  detail,
  disabled = false,
  onClick,
}: {
  selected: boolean;
  title: string;
  detail: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid gap-[7px] rounded-[13px] border p-4 text-left",
        selected ? "border-accent-strong bg-sel" : "border-line bg-panel2",
        disabled
          ? "cursor-not-allowed opacity-45"
          : "cursor-pointer hover:border-accent-strong",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "h-3.5 w-3.5 rounded-full border",
            selected
              ? "border-accent-strong bg-accent-strong"
              : "border-line2 bg-transparent",
          )}
        />
        <strong className="text-[12px] font-[620]">{title}</strong>
      </span>
      <span className="text-[11px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
        {detail}
      </span>
    </button>
  );
}

/** Single number with a label and a line of context. */
export function StatCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: ReactNode;
  detail: string;
}) {
  return (
    <div className="rounded-[13px] border border-line bg-panel2 px-[18px] py-4">
      <div className="text-[11px] text-ink-muted">{title}</div>
      <div className="mt-[9px] font-mono text-[19px] tracking-[-0.02em]">
        {value}
      </div>
      <div className="mt-[7px] text-[10.5px] leading-[1.6] text-faint [text-wrap:pretty]">
        {detail}
      </div>
    </div>
  );
}

/** Card carrying one call to action — the admin attention queue. */
export function QueueCard({
  tone,
  icon,
  title,
  detail,
  onClick,
}: {
  tone: Tone;
  icon: ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  const classes = TONE_CLASSES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid cursor-pointer grid-cols-[32px_minmax(0,1fr)] items-start gap-3 rounded-[13px] border border-line bg-panel2 px-4 py-[15px] text-left text-ink hover:border-accent-strong"
    >
      <span
        className={cn(
          "grid h-8 w-8 place-items-center rounded-[10px]",
          classes.bg,
          classes.text,
        )}
      >
        {icon}
      </span>
      <span className="grid min-w-0">
        <strong className="text-[12.5px] font-[620]">{title}</strong>
        <small className="mt-[5px] text-[11px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
          {detail}
        </small>
      </span>
    </button>
  );
}
