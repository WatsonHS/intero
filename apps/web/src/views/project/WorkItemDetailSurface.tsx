import {
  ArrowLeftIcon,
  ArrowCounterClockwiseIcon,
  GitBranchIcon,
  GitCommitIcon,
  LinkSimpleIcon,
  PaperPlaneTiltIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type {
  CodeReferenceKind,
  PrincipalId,
  WorkComment,
  WorkItemStatus,
  WorkPriority,
  WorkRelationKind,
} from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import {
  addWorkCodeReference,
  addWorkComment,
  addWorkRelation,
  getProjectWork,
  getProjectSpecs,
  removeWorkCodeReference,
  removeWorkComment,
  removeWorkRelation,
  revertWorkItem,
  updateWorkItem,
} from "../../api.js";
import { getPilotOverview } from "../../pilot/api.js";

export function WorkItemDetailSurface({
  projectId,
  workItemId,
  identityId,
  onBack,
}: {
  projectId: string;
  workItemId: string;
  identityId?: PrincipalId;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [replyTo, setReplyTo] = useState<string>();
  const [codeValue, setCodeValue] = useState("");
  const [codeKind, setCodeKind] = useState<CodeReferenceKind>("pull_request");
  const [relationTargetId, setRelationTargetId] = useState("");
  const [relationKind, setRelationKind] = useState<WorkRelationKind>("related");
  const work = useQuery({
    queryKey: ["project-work", projectId],
    queryFn: ({ signal }) => getProjectWork(projectId, signal),
    refetchInterval: 4_000,
  });
  const overview = useQuery({
    queryKey: ["pilot", "overview", identityId, projectId],
    queryFn: ({ signal }) => getPilotOverview(identityId!, projectId, signal),
    enabled: Boolean(identityId),
  });
  const specs = useQuery({
    queryKey: ["project-specs", projectId],
    queryFn: ({ signal }) => getProjectSpecs(projectId, signal),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["project-work", projectId] });
  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      updateWorkItem(projectId, workItemId, patch),
    onSuccess: refresh,
  });
  const revert = useMutation({
    mutationFn: (historyId: string) =>
      revertWorkItem(projectId, workItemId, historyId),
    onSuccess: refresh,
  });
  const sendComment = useMutation({
    mutationFn: () =>
      addWorkComment(projectId, workItemId, {
        body: comment.trim(),
        ...(replyTo ? { parentId: replyTo } : {}),
      }),
    onSuccess: async () => {
      setComment("");
      setReplyTo(undefined);
      await refresh();
    },
  });
  const removeComment = useMutation({
    mutationFn: (commentId: string) =>
      removeWorkComment(projectId, workItemId, commentId),
    onSuccess: refresh,
  });
  const removeCode = useMutation({
    mutationFn: (referenceId: string) =>
      removeWorkCodeReference(projectId, referenceId),
    onSuccess: refresh,
  });
  const addRelation = useMutation({
    mutationFn: () =>
      addWorkRelation(projectId, workItemId, {
        targetId: relationTargetId,
        kind: relationKind,
      }),
    onSuccess: async () => {
      setRelationTargetId("");
      await refresh();
    },
  });
  const removeRelation = useMutation({
    mutationFn: (relation: {
      sourceId: string;
      targetId: string;
      kind: WorkRelationKind;
    }) =>
      removeWorkRelation(
        projectId,
        relation.sourceId,
        relation.targetId,
        relation.kind,
      ),
    onSuccess: refresh,
  });
  const addCode = useMutation({
    mutationFn: () =>
      addWorkCodeReference(projectId, workItemId, {
        kind: codeKind,
        label: codeValue.trim(),
        value: codeValue.trim(),
      }),
    onSuccess: async () => {
      setCodeValue("");
      await refresh();
    },
  });

  const item = work.data?.workItems.find(
    (candidate) => candidate.id === workItemId,
  );
  if (!item || !work.data) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-faint">
        Loading Work Item…
      </div>
    );
  }
  const comments = work.data.comments.filter(
    (entry) => entry.workItemId === item.id && !entry.revokedAt,
  );
  const rootComments = comments.filter((entry) => !entry.parentId);
  const history = work.data.history.filter(
    (entry) => entry.workItemId === item.id,
  );
  const codeRefs = work.data.codeReferences.filter(
    (entry) => entry.workItemId === item.id,
  );
  const relations = work.data.relations.filter(
    (entry) => entry.sourceId === item.id || entry.targetId === item.id,
  );
  const principals = (overview.data?.principals ?? []).filter(
    (principal) => principal.kind === "human",
  );

  return (
    <div className="animate-view-enter grid h-full grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <header className="border-b border-line px-8 py-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-[11px] text-ink-muted"
          >
            <ArrowLeftIcon size={13} /> Project board
          </button>
          <p className="mt-4 font-mono text-[10px] text-faint">
            {work.data.project.name} / {item.id.slice(0, 8)}
          </p>
          <input
            key={`${item.id}:title:${item.updatedAt}`}
            defaultValue={item.title}
            onBlur={(event) => {
              const title = event.target.value.trim();
              if (title && title !== item.title) update.mutate({ title });
            }}
            className="mt-2 block w-full max-w-[720px] border-0 bg-transparent p-0 text-[25px] font-[570] tracking-[-0.03em] outline-none"
          />
          <textarea
            key={`${item.id}:description:${item.updatedAt}`}
            defaultValue={item.description}
            placeholder="No description yet."
            onBlur={(event) => {
              if (event.target.value !== item.description) {
                update.mutate({ description: event.target.value });
              }
            }}
            className="mt-3 block min-h-14 w-full max-w-[720px] resize-none border-0 bg-transparent p-0 text-[13px] leading-[1.75] text-ink-muted outline-none"
          />
        </header>
        <main className="overflow-auto px-8 py-6">
          <h2 className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
            ACTIVITY & COORDINATION
          </h2>
          <div className="mt-4 grid max-w-[760px] gap-3">
            {history.map((entry) => (
              <article
                key={entry.id}
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 rounded-card bg-panel2 p-3.5"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-raise">
                  <GitCommitIcon size={14} />
                </span>
                <span>
                  <strong className="text-[12px]">{entry.action}</strong>
                  <small className="mt-1 block text-[10.5px] text-faint">
                    {entry.actor.kind} · {entry.actor.source}
                  </small>
                </span>
                <time className="font-mono text-[9.5px] text-faint">
                  {new Date(entry.occurredAt).toLocaleString()}
                </time>
                <button
                  type="button"
                  disabled={revert.isPending}
                  onClick={() => revert.mutate(entry.id)}
                  className="col-start-3 inline-flex items-center gap-1 justify-self-end border-0 bg-transparent p-0 text-[9.5px] text-accent-strong disabled:opacity-45"
                >
                  <ArrowCounterClockwiseIcon size={11} />
                  Revert to this state
                </button>
              </article>
            ))}
            {rootComments.map((entry) => (
              <CommentThread
                key={entry.id}
                entry={entry}
                comments={comments}
                depth={0}
                onReply={setReplyTo}
                onRevoke={(commentId) => removeComment.mutate(commentId)}
              />
            ))}
            {history.length === 0 && comments.length === 0 ? (
              <p className="text-[12px] text-faint">No activity yet.</p>
            ) : null}
          </div>
        </main>
        <div className="border-t border-line p-5">
          <div className="mx-auto flex max-w-[760px] items-end gap-2 rounded-container border border-line2 bg-panel2 p-2">
            {replyTo ? (
              <button
                type="button"
                onClick={() => setReplyTo(undefined)}
                className="self-start rounded-pill bg-raise px-2 py-1 text-[9px] text-faint"
              >
                Replying · cancel
              </button>
            ) : null}
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Add a threaded comment…"
              className="min-h-16 flex-1 resize-none border-0 bg-transparent p-2 text-[12.5px] outline-none"
            />
            <button
              type="button"
              disabled={!comment.trim() || sendComment.isPending}
              onClick={() => sendComment.mutate()}
              className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent-strong text-on-accent disabled:opacity-45"
            >
              <PaperPlaneTiltIcon size={16} />
            </button>
          </div>
        </div>
      </div>
      <aside className="overflow-auto border-l border-line bg-panel p-6">
        <h2 className="text-[10.5px] font-[650] tracking-[0.08em] text-faint">
          FACTS
        </h2>
        <div className="mt-3 grid gap-2">
          <Field label="Status">
            <select
              value={item.status}
              onChange={(event) =>
                update.mutate({ status: event.target.value as WorkItemStatus })
              }
              className="w-full bg-transparent text-[12px] outline-none"
            >
              <option value="todo">Todo</option>
              <option value="in_progress">In progress</option>
              <option value="ready_for_test">Ready for test</option>
              <option value="done">Done</option>
            </select>
          </Field>
          <Field label="Owner">
            <select
              value={item.ownerId ?? ""}
              onChange={(event) =>
                update.mutate({
                  ownerId: event.target.value || null,
                })
              }
              className="w-full bg-transparent text-[12px] outline-none"
            >
              <option value="">Unassigned</option>
              {principals.map((principal) => (
                <option key={principal.id} value={principal.id}>
                  {principal.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={item.priority}
              onChange={(event) =>
                update.mutate({
                  priority: event.target.value as WorkPriority,
                })
              }
              className="w-full bg-transparent text-[12px] outline-none"
            >
              {(["unset", "P0", "P1", "P2", "P3"] as const).map((priority) => (
                <option value={priority} key={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Points">
            <input
              type="number"
              min={0}
              defaultValue={item.points}
              placeholder="—"
              onBlur={(event) =>
                update.mutate({
                  points: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
              className="w-full bg-transparent text-[12px] outline-none"
            />
          </Field>
          <Field label="Completion evidence">
            <textarea
              key={`${item.id}:evidence:${item.updatedAt}`}
              defaultValue={item.completionEvidence ?? ""}
              placeholder="Optional validation or artifact evidence"
              onBlur={(event) =>
                update.mutate({
                  completionEvidence: event.target.value.trim() || null,
                })
              }
              className="min-h-16 w-full resize-none bg-transparent text-[11.5px] leading-[1.55] outline-none"
            />
            {item.completedAt && item.completedBy ? (
              <small className="mt-1.5 block font-mono text-[9px] text-faint">
                Completed {new Date(item.completedAt).toLocaleString()} ·{" "}
                {item.completedBy.kind} · {item.completedBy.source}
              </small>
            ) : null}
          </Field>
          <Field label="Spec">
            <select
              value={item.specId ?? ""}
              onChange={(event) =>
                update.mutate({ specId: event.target.value || null })
              }
              className="w-full bg-transparent text-[12px] outline-none"
            >
              <option value="">No linked Spec</option>
              {specs.data?.items.map((detail) => (
                <option value={detail.spec.id} key={detail.spec.id}>
                  {detail.spec.title}
                </option>
              ))}
            </select>
          </Field>
          {item.sourceSpecRevisionId ? (
            <Field label="Confirmed Spec source">
              <p className="font-mono text-[9.5px] text-ink-muted">
                revision {item.sourceSpecRevisionId.slice(0, 8)}
              </p>
              <ul className="mt-1 grid gap-0.5 text-[9.5px] text-faint">
                {(item.sourceReferences ?? []).map((reference) => (
                  <li key={reference}>{reference}</li>
                ))}
              </ul>
              <small className="mt-1 block text-[9px] text-faint">
                policy {item.automationPolicyVersion ?? "unknown"}
              </small>
            </Field>
          ) : null}
          <Field label="PI">
            <select
              value={item.piId ?? ""}
              onChange={(event) =>
                update.mutate({
                  piId: event.target.value || null,
                  ...(!event.target.value ? { sprintId: null } : {}),
                })
              }
              className="w-full bg-transparent text-[12px] outline-none"
            >
              <option value="">Backlog</option>
              {work.data.programIncrements.map((pi) => (
                <option value={pi.id} key={pi.id}>
                  PI {pi.number} · {pi.status}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sprint">
            <select
              value={item.sprintId ?? ""}
              onChange={(event) => {
                const sprint = work.data.sprints.find(
                  (candidate) => candidate.id === event.target.value,
                );
                update.mutate({
                  sprintId: sprint?.id ?? null,
                  ...(sprint ? { piId: sprint.piId } : {}),
                });
              }}
              className="w-full bg-transparent text-[12px] outline-none"
            >
              <option value="">
                {item.carryover ? "Carryover" : "PI only / Backlog"}
              </option>
              {work.data.sprints.map((sprint) => (
                <option value={sprint.id} key={sprint.id}>
                  Sprint{" "}
                  {work.data.programIncrements.find(
                    (pi) => pi.id === sprint.piId,
                  )?.number ?? "?"}
                  .{sprint.number} · {sprint.status}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <h2 className="mt-7 text-[10.5px] font-[650] tracking-[0.08em] text-faint">
          RELATIONS & COORDINATION
        </h2>
        <div className="mt-3 grid gap-2 text-[11px]">
          {relations.map((relation) => (
            <div
              key={`${relation.sourceId}:${relation.targetId}:${relation.kind}`}
              className="rounded-card bg-raise p-2.5"
            >
              {relation.kind} ·{" "}
              {(relation.sourceId === item.id
                ? relation.targetId
                : relation.sourceId
              ).slice(0, 8)}
              {relation.sourceSpecRevisionId ? (
                <small className="mt-1 block font-mono text-[9px] text-faint">
                  confirmed Spec {relation.sourceSpecRevisionId.slice(0, 8)}
                </small>
              ) : null}
              <button
                type="button"
                aria-label="Revoke relation"
                disabled={removeRelation.isPending}
                onClick={() => removeRelation.mutate(relation)}
                className="float-right border-0 bg-transparent p-0 text-faint hover:text-danger"
              >
                <TrashIcon size={12} />
              </button>
            </div>
          ))}
          {item.coordinationThreadIds.map((id) => (
            <div key={id} className="rounded-card bg-raise p-2.5">
              Coordination · {id.slice(0, 8)}
            </div>
          ))}
          <div className="grid gap-2 rounded-card border border-line2 p-2.5">
            <select
              value={relationKind}
              onChange={(event) =>
                setRelationKind(event.target.value as WorkRelationKind)
              }
              className="h-7 bg-transparent text-[10.5px]"
            >
              <option value="blocks">Blocks</option>
              <option value="blocked_by">Blocked by</option>
              <option value="related">Related</option>
              <option value="duplicate">Duplicate</option>
              <option value="duplicated_by">Duplicated by</option>
            </select>
            <select
              value={relationTargetId}
              onChange={(event) => setRelationTargetId(event.target.value)}
              className="h-7 bg-transparent text-[10.5px]"
            >
              <option value="">Select Work Item</option>
              {work.data.workItems
                .filter((candidate) => candidate.id !== item.id)
                .map((candidate) => (
                  <option value={candidate.id} key={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={!relationTargetId || addRelation.isPending}
              onClick={() => addRelation.mutate()}
              className="h-8 rounded-btn bg-raise text-[10.5px] disabled:opacity-45"
            >
              Add relation
            </button>
          </div>
        </div>

        <h2 className="mt-7 text-[10.5px] font-[650] tracking-[0.08em] text-faint">
          CODE
        </h2>
        <div className="mt-3 grid gap-2">
          {codeRefs.map((reference) => (
            <div key={reference.id} className="rounded-card bg-raise p-3">
              <div className="flex items-center gap-2 text-[10px] text-faint">
                {reference.kind === "branch" ? (
                  <GitBranchIcon size={13} />
                ) : (
                  <LinkSimpleIcon size={13} />
                )}
                {reference.kind}
                <button
                  type="button"
                  aria-label="Remove code reference"
                  onClick={() => removeCode.mutate(reference.id)}
                  className="ml-auto grid h-6 w-6 place-items-center rounded-[7px] text-faint hover:bg-panel2"
                >
                  <TrashIcon size={12} />
                </button>
              </div>
              <p className="mt-1.5 break-all font-mono text-[10.5px]">
                {reference.value}
              </p>
            </div>
          ))}
          <div className="grid gap-2 rounded-card border border-line2 p-2.5">
            <select
              value={codeKind}
              onChange={(event) =>
                setCodeKind(event.target.value as CodeReferenceKind)
              }
              className="h-7 bg-transparent text-[10.5px]"
            >
              <option value="pull_request">Pull request</option>
              <option value="commit">Commit</option>
              <option value="branch">Branch</option>
            </select>
            <input
              value={codeValue}
              onChange={(event) => setCodeValue(event.target.value)}
              placeholder="Explicit reference"
              className="h-8 rounded-[8px] border border-line2 bg-transparent px-2 text-[10.5px]"
            />
            <button
              type="button"
              disabled={!codeValue.trim() || addCode.isPending}
              onClick={() => addCode.mutate()}
              className="h-8 rounded-btn bg-accent-strong text-[10.5px] text-on-accent disabled:opacity-45"
            >
              Attach
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function CommentThread({
  entry,
  comments,
  depth,
  onReply,
  onRevoke,
}: {
  entry: WorkComment;
  comments: WorkComment[];
  depth: number;
  onReply: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  const replies = comments.filter(
    (candidate) => candidate.parentId === entry.id,
  );
  return (
    <div className={depth === 0 ? "" : "ml-7 border-l border-line pl-3"}>
      <article className="rounded-card border border-line bg-panel2 p-4">
        <div className="text-[10px] text-faint">
          {depth > 0 ? "Reply · " : ""}
          {entry.author.kind} · {new Date(entry.createdAt).toLocaleString()}
        </div>
        <p className="mt-2 text-[12.5px] leading-[1.7]">{entry.body}</p>
        {entry.sourceSpecRevisionId ? (
          <p className="mt-1 font-mono text-[9px] text-faint">
            confirmed Spec {entry.sourceSpecRevisionId.slice(0, 8)} ·{" "}
            {(entry.sourceReferences ?? []).join(", ")}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => onReply(entry.id)}
          className="mt-2 border-0 bg-transparent p-0 text-[10px] text-accent-strong"
        >
          Reply
        </button>
        <button
          type="button"
          aria-label="Revoke comment"
          onClick={() => onRevoke(entry.id)}
          className="ml-3 border-0 bg-transparent p-0 text-[10px] text-faint hover:text-danger"
        >
          Revoke
        </button>
      </article>
      {replies.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {replies.map((reply) => (
            <CommentThread
              key={reply.id}
              entry={reply}
              comments={comments}
              depth={depth + 1}
              onReply={onReply}
              onRevoke={onRevoke}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[70px_minmax(0,1fr)] items-center rounded-[9px] p-2 hover:bg-panel2">
      <span className="text-[10.5px] text-faint">{label}</span>
      <span className="text-[12px]">{children}</span>
    </div>
  );
}
