import {
  ArrowUpIcon,
  CircleNotchIcon,
  LockSimpleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { getThreads, sendThreadMessage } from "../api.js";

export function ProjectRoomView() {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const threads = useQuery({
    queryKey: ["threads", "room"],
    queryFn: ({ signal }) => getThreads("room", signal),
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
      await queryClient.invalidateQueries({ queryKey: ["threads", "room"] });
    },
  });

  function submit() {
    if (!current || !humanId || !draft.trim() || send.isPending) return;
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
          <span className="representative-mark">
            <UsersThreeIcon size={21} />
          </span>
          <span>
            <p className="eyebrow">Shared project conversation</p>
            <h1>{current?.thread.title ?? "Project Room"}</h1>
          </span>
        </div>
        <div className="runtime-switch">
          <span className="runtime-switch__active">
            {current?.thread.participantIds.length ?? 0} participants
          </span>
          <small>{threads.isFetching ? "syncing" : "live"}</small>
        </div>
      </header>

      <div className="thread-body">
        <div className="date-divider">
          <span>Today</span>
        </div>
        {current ? (
          current.messages.map((message) => {
            const representative = current.thread.representativeIds.includes(
              message.senderId,
            );
            return (
              <article
                className={
                  representative
                    ? "message message--representative"
                    : "message message--human"
                }
                key={message.id}
              >
                <div className="message__meta">
                  <strong>
                    {representative ? "Intero Representative" : "Huang Sheng"}
                  </strong>
                  {representative ? <span>Representative</span> : null}
                  <time>{formatTime(message.createdAt)}</time>
                </div>
                <p>
                  {message.serverReadable
                    ? message.body
                    : "Encrypted human-only message"}
                </p>
              </article>
            );
          })
        ) : (
          <article className="thread-empty">
            {threads.isLoading ? (
              <CircleNotchIcon size={21} className="spin" />
            ) : (
              <UsersThreeIcon size={23} />
            )}
            <h2>
              {threads.isLoading
                ? "Loading the Project Room…"
                : "No Project Room yet"}
            </h2>
            <p>
              Project Rooms keep team discussion and visible Representative
              actions together.
            </p>
          </article>
        )}
      </div>

      <div className="composer">
        <div className="composer__privacy">
          <LockSimpleIcon size={14} />
          Project Room · team-visible and agent-readable
        </div>
        <div className="composer__row">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Share a decision, question, or team update…"
            rows={1}
            disabled={!current}
          />
          <button
            type="button"
            className="send-button"
            aria-label="Send Room message"
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
