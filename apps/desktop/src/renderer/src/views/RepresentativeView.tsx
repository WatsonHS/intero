import {
  ArrowUpIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  GitBranchIcon,
  LockSimpleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createConversationThread,
  getBootstrap,
  getOfflineStatus,
  getThreads,
  sendThreadMessage,
} from "../api.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";

export function RepresentativeView({
  coordination = false,
}: {
  coordination?: boolean;
}) {
  const { formatRelative, formatTime, t } = useI18n();
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const kind = coordination ? "coordination" : "representative";
  const threads = useQuery({
    queryKey: ["threads", kind],
    queryFn: ({ signal }) => getThreads(kind, signal),
    refetchInterval: 3_000,
  });
  const runtime = useQuery({
    queryKey: ["offline-status"],
    queryFn: ({ signal }) => getOfflineStatus(signal),
    refetchInterval: 5_000,
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
      await queryClient.invalidateQueries({ queryKey: ["threads", kind] });
    },
  });
  const createThread = useMutation({
    mutationFn: async () => {
      const identity = bootstrap.data;
      if (!identity) throw new Error("Identity is unavailable.");
      return createConversationThread({
        kind: "representative",
        title: t("thread.yourRepresentative"),
        participantIds: [
          identity.currentPrincipal.id,
          identity.representativePrincipal.id,
        ],
        representativeIds: [identity.representativePrincipal.id],
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["threads", "representative"],
      });
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
              {coordination ? t("thread.structured") : t("thread.oneIdentity")}
            </p>
            <h1>
              {current?.thread.title ??
                (coordination
                  ? t("thread.coordination")
                  : t("thread.yourRepresentative"))}
            </h1>
          </span>
        </div>
        <div className="runtime-switch">
          <span
            className={
              runtime.data?.fallback === "local" ? "runtime-switch__active" : ""
            }
          >
            {t("thread.local")}
          </span>
          <span
            className={
              runtime.data?.fallback === "public"
                ? "runtime-switch__active"
                : ""
            }
          >
            {t("thread.public")}
          </span>
          <small>
            {runtime.data?.freshnessAt
              ? formatRelative(runtime.data.freshnessAt)
              : t("general.unavailable")}
          </small>
        </div>
      </header>

      <div className="thread-body">
        <div className="date-divider">
          <span>{t("general.today")}</span>
        </div>
        {threads.isError ? (
          <article className="thread-empty">
            <h2>{t("thread.unavailable")}</h2>
            <button type="button" onClick={() => void threads.refetch()}>
              {t("general.retry")}
            </button>
          </article>
        ) : threads.isLoading ? (
          <article className="thread-empty">
            <CircleNotchIcon size={20} className="spin" />
            <p>{t("thread.loading")}</p>
          </article>
        ) : current ? (
          current.messages.map((message) =>
            message.kind === "coordination_action" ? (
              <article className="coordination-envelope" key={message.id}>
                {(() => {
                  const action = current.actions.find(
                    (item) => item.envelope.operationId === message.operationId,
                  );
                  return (
                    <>
                      <div className="coordination-envelope__header">
                        <GitBranchIcon size={19} />
                        <span>
                          <strong>{t("thread.coordinationAction")}</strong>
                          <small>{t("thread.attributable")}</small>
                        </span>
                        {action ? (
                          <span className="status-chip">
                            {t("thread.resolved")}
                          </span>
                        ) : null}
                      </div>
                      <dl>
                        <div>
                          <dt>{t("thread.sequence")}</dt>
                          <dd>{message.sequence}</dd>
                        </div>
                        {action ? (
                          <>
                            <div>
                              <dt>{t("thread.action")}</dt>
                              <dd>
                                {t(
                                  `coordination.${action.envelope.action}` as TranslationKey,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>{t("thread.policy")}</dt>
                              <dd>{action.envelope.policyVersion}</dd>
                            </div>
                            <div>
                              <dt>{t("thread.scope")}</dt>
                              <dd>
                                {action.envelope.resourceScope.join(", ") ||
                                  t("general.none")}
                              </dd>
                            </div>
                          </>
                        ) : null}
                        <div>
                          <dt>{t("thread.result")}</dt>
                          <dd>{message.body}</dd>
                        </div>
                      </dl>
                    </>
                  );
                })()}
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
                      ? (principalNames.get(message.senderId) ??
                        t("thread.representative"))
                      : (principalNames.get(message.senderId) ??
                        t("general.you"))}
                  </strong>
                  {current.thread.representativeIds.includes(
                    message.senderId,
                  ) ? (
                    <span>
                      {runtime.data?.fallback === "local"
                        ? t("thread.localRuntime")
                        : t("thread.public")}
                    </span>
                  ) : null}
                  <time>{formatTime(message.createdAt)}</time>
                </div>
                <p>
                  {message.serverReadable
                    ? message.body
                    : t("thread.encryptedMessage")}
                </p>
                {current.thread.representativeIds.includes(message.senderId) ? (
                  <div className="evidence-strip">
                    <CheckCircleIcon size={17} weight="fill" />
                    <span>
                      {t("thread.durableSequence", {
                        sequence: message.sequence,
                      })}
                    </span>
                    <span>
                      {message.serverReadable
                        ? t("thread.agentReadable")
                        : t("thread.encrypted")}
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
                ? t("thread.emptyCoordination")
                : t("thread.emptyRepresentative")}
            </h2>
            <p>
              {coordination
                ? t("thread.emptyCoordinationDetail")
                : t("thread.emptyRepresentativeDetail")}
            </p>
            {!coordination ? (
              <button
                className="button button--primary"
                type="button"
                disabled={!bootstrap.data || createThread.isPending}
                onClick={() => createThread.mutate()}
              >
                {t("thread.startRepresentative")}
              </button>
            ) : null}
            {createThread.isError ? (
              <p className="composer-error">{t("thread.createFailed")}</p>
            ) : null}
          </article>
        )}
        {send.isError ? (
          <p className="composer-error" role="alert">
            {t("thread.sendFailed")}
          </p>
        ) : null}
      </div>

      <div className="composer">
        <div className="composer__privacy">
          <LockSimpleIcon size={14} />
          {current?.thread.accessMode === "human_only_e2ee"
            ? t("thread.humanOnlyPrivacy")
            : t("thread.representativePrivacy")}
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
            placeholder={t("thread.placeholder")}
            rows={1}
            disabled={!current}
          />
          <button
            type="button"
            className="send-button"
            aria-label={t("thread.send")}
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
