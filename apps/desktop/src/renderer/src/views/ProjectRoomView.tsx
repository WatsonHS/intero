import {
  ArrowUpIcon,
  CircleNotchIcon,
  LockSimpleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createConversationThread,
  getBootstrap,
  getThreads,
  sendThreadMessage,
} from "../api.js";
import { useI18n } from "../i18n/index.js";

export function ProjectRoomView() {
  const { formatTime, t } = useI18n();
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const threads = useQuery({
    queryKey: ["threads", "room"],
    queryFn: ({ signal }) => getThreads("room", signal),
    refetchInterval: 3_000,
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const current = threads.data?.items[0];
  const principalNames = new Map(
    current?.principals.map((principal) => [
      principal.id,
      principal.displayName,
    ]) ?? [],
  );
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
  const createRoom = useMutation({
    mutationFn: async () => {
      const identity = bootstrap.data;
      if (!identity) throw new Error("Identity is unavailable.");
      return createConversationThread({
        kind: "room",
        title: t("room.title"),
        participantIds: [
          identity.currentPrincipal.id,
          identity.representativePrincipal.id,
        ],
        representativeIds: [identity.representativePrincipal.id],
      });
    },
    onSuccess: async () => {
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
            <p className="eyebrow">{t("room.sharedConversation")}</p>
            <h1>{current?.thread.title ?? t("room.title")}</h1>
          </span>
        </div>
        <div className="runtime-switch">
          <span className="runtime-switch__active">
            {t("general.participants", {
              count: current?.thread.participantIds.length ?? 0,
            })}
          </span>
          <small>
            {threads.isFetching ? t("general.syncing") : t("general.live")}
          </small>
        </div>
      </header>

      <div className="thread-body">
        <div className="date-divider">
          <span>{t("general.today")}</span>
        </div>
        {threads.isError ? (
          <article className="thread-empty">
            <h2>{t("room.unavailable")}</h2>
            <button type="button" onClick={() => void threads.refetch()}>
              {t("general.retry")}
            </button>
          </article>
        ) : current ? (
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
                    {principalNames.get(message.senderId) ??
                      (representative
                        ? t("thread.representative")
                        : message.senderId.slice(0, 8))}
                  </strong>
                  {representative ? (
                    <span>{t("room.representativeRole")}</span>
                  ) : null}
                  <time>{formatTime(message.createdAt)}</time>
                </div>
                <p>
                  {message.serverReadable
                    ? message.body
                    : t("thread.encryptedMessage")}
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
            <h2>{threads.isLoading ? t("room.loading") : t("room.empty")}</h2>
            <p>{t("room.emptyDetail")}</p>
            {!threads.isLoading ? (
              <button
                className="button button--primary"
                type="button"
                disabled={!bootstrap.data || createRoom.isPending}
                onClick={() => createRoom.mutate()}
              >
                {t("room.create")}
              </button>
            ) : null}
            {createRoom.isError ? (
              <p className="composer-error">{t("room.createFailed")}</p>
            ) : null}
          </article>
        )}
      </div>

      <div className="composer">
        <div className="composer__privacy">
          <LockSimpleIcon size={14} />
          {t("room.privacy")}
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
            placeholder={t("room.placeholder")}
            rows={1}
            disabled={!current}
          />
          <button
            type="button"
            className="send-button"
            aria-label={t("room.send")}
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
