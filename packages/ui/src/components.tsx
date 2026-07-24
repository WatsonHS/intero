import {
  ArrowRightIcon,
  ClockCountdownIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function PhaseLabel({
  phase,
  label = phase.replace("_", " "),
}: {
  phase: string;
  label?: string;
}) {
  return (
    <span className={`phase-label phase-label--${phase}`}>
      <span className="phase-label__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function FreshnessLabel({
  timestamp,
  stale = false,
  label,
}: {
  timestamp: string;
  stale?: boolean;
  label?: string;
}) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(timestamp)) / 60_000),
  );
  return (
    <span className={stale ? "freshness freshness--stale" : "freshness"}>
      <ClockCountdownIcon size={14} weight="regular" aria-hidden="true" />
      {label ?? (minutes === 0 ? "now" : `${minutes}m ago`)}
    </span>
  );
}

export function ConfidenceBar({
  value,
  label,
}: {
  value: number;
  label?: string;
}) {
  return (
    <div
      className="confidence"
      aria-label={label ?? `${Math.round(value * 100)} percent confidence`}
    >
      <span className="confidence__track">
        <span
          className="confidence__value"
          style={{ transform: `scaleX(${value})` }}
        />
      </span>
      <span>{Math.round(value * 100)}</span>
    </div>
  );
}

export function AttentionItem({
  eyebrow,
  title,
  detail,
  onOpen,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  onOpen?: () => void;
}) {
  return (
    <button type="button" className="attention-item" onClick={onOpen}>
      <span className="attention-item__icon">
        <WarningCircleIcon size={18} weight="regular" aria-hidden="true" />
      </span>
      <span className="attention-item__copy">
        <span className="attention-item__eyebrow">{eyebrow}</span>
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <ArrowRightIcon size={16} weight="regular" aria-hidden="true" />
    </button>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark" aria-hidden="true">
        I
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

export function LoadingRows({
  label = "Loading Team Pulse",
}: {
  label?: string;
}) {
  return (
    <div className="loading-rows" aria-label={label}>
      {[0, 1, 2].map((row) => (
        <div className="loading-row" key={row}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
