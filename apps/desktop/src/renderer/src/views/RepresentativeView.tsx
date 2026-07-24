import {
  ArrowUpIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  GitBranchIcon,
  LockSimpleIcon,
  PaperclipIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { getThreads, sendThreadMessage } from "../api.js";

export function RepresentativeView({
  coordination = false,
}: {
  coordination?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const kind = coordination ? "coordination" : "representative";
  const threads = useQuery({
    queryKey: ["threads", kind],
    queryFn: ({ signal }) => getThreads(kind, signal),
    refetchInterval: 3_000,
  });
  const current = threads.data?.items[0];
  const humanId = current?.thread.participantIds.find(
    (participantId) =>
      !current.thread.representativeIds.includes(participantId),
  );
  const send = useMutation({
    mutationFn: sendThreadMessage,
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["threads", kind] });
    },
  });

  function submit() {
    if (!draft.trim() || !current || !humanId || send.isPending) return;
    send.mutate({
      threadId: current.thread.id,
      senderId: humanId,
      body: draft.trim(),
    });
  }

  return (
    <div className="thread-view">
      <header className="thread-header">
        <div className="thread-header__identity">
          <span className="representative-mark">IR</span>
          <span>
            <p className="eyebrow">
              {coordination
                ? "Structured thread"
                : "One identity, two runtimes"}
            </p>
            <h1>
              {current?.thread.title ??
                (coordination ? "Coordination" : "Your Representative")}
            </h1>
          </span>
        </div>
        <div className="runtime-switch">
          <span className="runtime-switch__active">Local</span>
          <span>Public</span>
          <small>{threads.isFetching ? "syncing" : "fresh"}</small>
        </div>
      </header>

      <div className="thread-body">
        <div className="date-divider">
          <span>Today</span>
        </div>
        {threads.isLoading ? (
          <article className="thread-empty">
            <CircleNotchIcon size={20} className="spin" />
            <p>Loading the durable thread…</p>
          </article>
        ) : current ? (
          current.messages.map((message) =>
            message.kind === "coordination_action" ? (
              <article className="coordination-envelope" key={message.id}>
                <div className="coordination-envelope__header">
                  <GitBranchIcon size={19} />
                  <span>
                    <strong>Coordination request</strong>
                    <small>Visible, attributable, policy checked</small>
                  </span>
                  <span className="status-chip">resolved</span>
                </div>
                <dl>
                  <div>
                    <dt>Sequence</dt>
                    <dd>{message.sequence}</dd>
                  </div>
                  <div>
                    <dt>Authority</dt>
                    <dd>capability grant · checked</dd>
                  </div>
                  <div>
                    <dt>Result</dt>
                    <dd>{message.body}</dd>
                  </div>
                </dl>
              </article>
            ) : (
              <article
                className={
                  current.thread.representativeIds.includes(message.senderId)
                    ? "message message--representative"
                    : "message message--human"
                }
                key={message.id}
              >
                <div className="message__meta">
                  <strong>
                    {current.thread.representativeIds.includes(message.senderId)
                      ? "Intero Representative"
                      : "You"}
                  </strong>
                  {current.thread.representativeIds.includes(
                    message.senderId,
                  ) ? (
                    <span>Local runtime</span>
                  ) : null}
                  <time>{formatTime(message.createdAt)}</time>
                </div>
                <p>
                  {message.serverReadable
                    ? message.body
                    : "Encrypted human-only message"}
                </p>
                {current.thread.representativeIds.includes(message.senderId) ? (
                  <div className="evidence-strip">
                    <CheckCircleIcon size={17} weight="fill" />
                    <span>durable sequence {message.sequence}</span>
                    <span>
                      {message.serverReadable ? "agent-readable" : "encrypted"}
                    </span>
                  </div>
                ) : null}
              </article>
            ),
          )
        ) : (
          <article className="thread-empty">
            <GitBranchIcon size={22} />
            <h2>
              {coordination
                ? "No coordination branch yet"
                : "No Representative Thread yet"}
            </h2>
            <p>
              {coordination
                ? "A policy-checked request from an agent will appear here with its authority and result."
                : "Enroll the local runtime to open a durable Representative Thread."}
            </p>
          </article>
        )}
        {send.isError ? (
          <p className="composer-error" role="alert">
            Message could not be persisted. Try again.
          </p>
        ) : null}
      </div>

      <div className="composer">
        <div className="composer__privacy">
          <LockSimpleIcon size={14} />
          {current?.thread.accessMode === "human_only_e2ee"
            ? "Human-only Thread · end-to-end encrypted"
            : "Representative Thread · authorized participants only"}
        </div>
        <div className="composer__row">
          <button
            type="button"
            className="icon-button"
            aria-label="Attach file"
          >
            <PaperclipIcon size={19} />
          </button>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about private work, team state, or a coordination branch…"
            rows={1}
            disabled={!current}
          />
          <button
            type="button"
            className="send-button"
            aria-label="Send message"
            disabled={!draft.trim() || !current || !humanId || send.isPending}
            onClick={submit}
          >
            {send.isPending ? (
              <CircleNotchIcon size={18} className="spin" />
            ) : (
              <ArrowUpIcon size={18} weight="bold" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
