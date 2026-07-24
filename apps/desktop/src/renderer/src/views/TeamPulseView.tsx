import { ChatCircleDotsIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import {
  AttentionItem,
  ConfidenceBar,
  EmptyState,
  FreshnessLabel,
  LoadingRows,
  PhaseLabel,
} from "@intero/ui";

import { getActionInbox, getOfflineStatus, getTeamPulse } from "../api.js";

const DEMO_PRINCIPAL_ID = "019b5ac0-7600-7000-8000-000000000002";

export function TeamPulseView({
  onOpenRepresentative,
}: {
  onOpenRepresentative: () => void;
}) {
  const pulse = useQuery({
    queryKey: ["team-pulse"],
    queryFn: ({ signal }) => getTeamPulse(signal),
    refetchInterval: 30_000,
  });
  const inbox = useQuery({
    queryKey: ["action-inbox"],
    queryFn: ({ signal }) => getActionInbox(signal),
  });
  const runtime = useQuery({
    queryKey: ["offline-status"],
    queryFn: ({ signal }) => getOfflineStatus(signal),
  });

  return (
    <div className="pulse-layout">
      <section className="pulse-main">
        <header className="view-header">
          <div>
            <p className="eyebrow">Friday, 24 July</p>
            <h1>Team Pulse</h1>
            <p className="view-header__lede">
              Current intent, verified movement, and the decisions that need a
              person.
            </p>
          </div>
        </header>

        <div className="pulse-summary">
          <div>
            <span className="pulse-summary__number">
              {pulse.data?.projections.length ?? "—"}
            </span>
            <span>active workstreams</span>
          </div>
          <div>
            <span className="pulse-summary__number">
              {pulse.data?.projections.filter(
                (item) => item.phase === "blocked",
              ).length ?? "—"}
            </span>
            <span>blocked by shared context</span>
          </div>
          <div className="runtime-readout">
            <span
              className={
                runtime.data?.stale
                  ? "runtime-dot runtime-dot--stale"
                  : "runtime-dot"
              }
            />
            <span>
              <strong>
                {runtime.data?.fallback === "public"
                  ? "Public fallback"
                  : "Local runtime"}
              </strong>
              <small>
                {runtime.data?.disclosure ?? "Checking runtime freshness"}
              </small>
            </span>
          </div>
        </div>

        <div className="section-heading">
          <div>
            <p className="eyebrow">Concurrent work</p>
            <h2>Where the team is now</h2>
          </div>
        </div>

        {pulse.isPending ? <LoadingRows /> : null}
        {pulse.isError ? (
          <div className="inline-error">
            <strong>Team Pulse is unavailable.</strong>
            <span>{pulse.error.message}</span>
            <button type="button" onClick={() => void pulse.refetch()}>
              Try again
            </button>
          </div>
        ) : null}
        {pulse.data?.projections.length === 0 ? (
          <EmptyState
            title="No public Work State yet"
            detail="Enroll a Workspace and let a Coding Agent report one semantic checkpoint."
          />
        ) : null}
        <div className="workstream-list">
          {pulse.data?.projections.map((workstream, index) => (
            <article
              className="workstream-row"
              key={workstream.id}
              style={{ "--row-index": index } as CSSProperties}
            >
              <div className="workstream-row__owner">
                <span className="person-avatar">
                  {ownerInitials(workstream.ownerId)}
                </span>
                <span>
                  <strong>{ownerLabel(workstream.ownerId)}</strong>
                  <small>Workstream owner</small>
                </span>
              </div>
              <div className="workstream-row__body">
                <div className="workstream-row__title">
                  <PhaseLabel phase={workstream.phase} />
                  <h3>{workstream.title}</h3>
                </div>
                <p>
                  {workstream.blockers[0] ??
                    workstream.dependencies[0] ??
                    workstream.decisions[0] ??
                    "No organizational state change since the last checkpoint."}
                </p>
                <div className="workstream-row__meta">
                  <FreshnessLabel timestamp={workstream.freshnessAt} />
                  <ConfidenceBar value={workstream.confidence} />
                  <span>
                    {workstream.changedFields.length} meaningful changes
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="attention-rail">
        <div className="attention-rail__header">
          <div>
            <p className="eyebrow">Only what needs you</p>
            <h2>Action Inbox</h2>
          </div>
          <span className="count-badge">{inbox.data?.items.length ?? 0}</span>
        </div>
        <div className="attention-list">
          {inbox.data?.items.map((item) => (
            <AttentionItem
              key={item.id}
              eyebrow={item.kind.replaceAll("_", " ")}
              title={item.title}
              detail={item.detail}
            />
          ))}
          {inbox.data?.items.length === 0 ? (
            <p className="quiet-copy">
              No decision, review, or scope expansion is waiting.
            </p>
          ) : null}
        </div>

        <div className="representative-peek">
          <div className="representative-peek__identity">
            <span className="representative-mark" aria-hidden="true">
              IR
            </span>
            <span>
              <strong>Your Representative</strong>
              <small>Local + public identity</small>
            </span>
          </div>
          <p>
            “One cross-project dependency looks material. I have not made a
            commitment.”
          </p>
          <button type="button" onClick={onOpenRepresentative}>
            <ChatCircleDotsIcon size={17} />
            Open thread
          </button>
        </div>
      </aside>
    </div>
  );
}

function ownerLabel(ownerId: string) {
  return ownerId === DEMO_PRINCIPAL_ID
    ? "Huang Sheng"
    : `Principal ${ownerId.slice(0, 8)}`;
}

function ownerInitials(ownerId: string) {
  return ownerId === DEMO_PRINCIPAL_ID
    ? "HS"
    : ownerId.slice(0, 2).toUpperCase();
}
