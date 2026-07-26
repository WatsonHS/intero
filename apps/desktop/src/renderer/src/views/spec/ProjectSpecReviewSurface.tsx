import {
  CheckCircleIcon,
  ChatCircleIcon,
  CodeIcon,
  EyeIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  addProjectSpecComment,
  confirmProjectSpec,
  createProjectSpecVersion,
  getProjectSpecs,
  requestProjectSpecReview,
  setProjectSpecCommentStatus,
  updateProjectSpecReviewPolicy,
} from "../../api.js";
import { SafeMarkdown } from "../../components/SafeMarkdown.js";
import { getPilotOverview } from "../../pilot/api.js";
import { usePilotOptional } from "../../pilot/context.js";

export function ProjectSpecReviewSurface({
  projectId,
  projects,
  onProjectChange,
}: {
  projectId: string;
  projects: Array<{ id: string; name: string }>;
  onProjectChange: (projectId: string) => void;
}) {
  const pilot = usePilotOptional();
  const queryClient = useQueryClient();
  const specs = useQuery({
    queryKey: ["project-specs", projectId],
    queryFn: ({ signal }) => getProjectSpecs(projectId, signal),
    refetchInterval: 4_000,
  });
  const overview = useQuery({
    queryKey: ["pilot", "overview", pilot?.identityId, projectId],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot!.identityId!, projectId, signal),
    enabled: Boolean(pilot?.identityId),
  });
  const [activeId, setActiveId] = useState<string>("new");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>();
  const [lineStart, setLineStart] = useState(1);
  const [lineEnd, setLineEnd] = useState(1);
  const [comment, setComment] = useState("");
  const [replyThreadId, setReplyThreadId] = useState<string>();
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["project-specs", projectId] });
  const active = specs.data?.items.find((item) => item.spec.id === activeId);
  const current = active?.revisions.find(
    (revision) => revision.id === active.spec.currentRevisionId,
  );
  const selected =
    active?.revisions.find((revision) => revision.id === selectedRevisionId) ??
    current;

  useEffect(() => {
    if (activeId === "new" && specs.data?.items[0]) {
      setActiveId(specs.data.items[0].spec.id);
    }
  }, [activeId, specs.data?.items]);
  useEffect(() => {
    if (!active || !current) return;
    setTitle(active.spec.title);
    setMarkdown(current.markdown);
    setSelectedRevisionId(current.id);
    setReviewerIds(active.nominatedReviewerIds);
  }, [active?.spec.id, current?.id]);

  const publish = useMutation({
    mutationFn: () =>
      createProjectSpecVersion(projectId, {
        ...(active ? { specId: active.spec.id } : {}),
        title: title.trim(),
        markdown,
        changeSummary: active ? "Updated from Spec Review" : "Initial version",
        affectedScopes: [],
      }),
    onSuccess: async (detail) => {
      setActiveId(detail.spec.id);
      setMode("preview");
      await refresh();
    },
  });
  const requestReview = useMutation({
    mutationFn: () =>
      requestProjectSpecReview(projectId, active!.spec.id, reviewerIds),
    onSuccess: refresh,
  });
  const confirm = useMutation({
    mutationFn: () => confirmProjectSpec(projectId, active!.spec.id),
    onSuccess: refresh,
  });
  const addComment = useMutation({
    mutationFn: () =>
      addProjectSpecComment(projectId, active!.spec.id, {
        revisionId: selected!.id,
        ...(replyThreadId ? { threadId: replyThreadId } : {}),
        lineStart,
        lineEnd,
        body: comment.trim(),
      }),
    onSuccess: async () => {
      setComment("");
      setReplyThreadId(undefined);
      await refresh();
    },
  });
  const setThreadStatus = useMutation({
    mutationFn: (input: {
      threadId: string;
      status: "open" | "resolved";
    }) =>
      setProjectSpecCommentStatus(
        projectId,
        input.threadId,
        input.status,
      ),
    onSuccess: refresh,
  });
  const updatePolicy = useMutation({
    mutationFn: (input: {
      requiredConfirmations: number;
      otherMemberAgentsCount: boolean;
      authorSelfConfirmation: boolean;
    }) => updateProjectSpecReviewPolicy(projectId, input),
    onSuccess: refresh,
  });

  if (specs.isPending) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-faint">
        Loading Spec Review…
      </div>
    );
  }
  if (specs.isError) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-danger">
        Spec Review is unavailable.
      </div>
    );
  }

  const threads =
    active?.commentThreads.filter(
      (thread) => thread.revisionId === selected?.id,
    ) ?? [];
  const confirmationCount =
    active?.confirmations.filter(
      (entry) => entry.revisionId === current?.id,
    ).length ?? 0;
  const project = pilot?.projects.data?.projects.find(
    (candidate) => candidate.id === projectId,
  );
  const organizationAdmin =
    pilot?.bootstrap.data?.organizationRole === "admin";
  const teamLeader = pilot?.teams.data?.teams
    .find((team) => team.id === project?.primaryTeamId)
    ?.members.some(
      (member) =>
        member.id === pilot.identityId && member.teamRole === "leader",
    );
  const canGovern = Boolean(organizationAdmin || teamLeader);
  const humanReviewers = (overview.data?.principals ?? []).filter(
    (principal) =>
      principal.kind === "human" && principal.id !== pilot?.identityId,
  );

  return (
    <div className="animate-view-enter grid h-full grid-cols-[240px_minmax(0,1fr)_340px]">
      <aside className="overflow-auto border-r border-line bg-panel p-5">
        <div className="flex items-center">
          <strong className="text-[13px]">Spec Review</strong>
          <button
            type="button"
            onClick={() => {
              setActiveId("new");
              setTitle("");
              setMarkdown("");
              setMode("edit");
            }}
            className="ml-auto grid h-7 w-7 place-items-center rounded-[8px] bg-raise"
          >
            <PlusIcon size={14} />
          </button>
        </div>
        <label className="mt-3 block text-[10px] text-faint">
          Project filter
          <select
            value={projectId}
            onChange={(event) => onProjectChange(event.target.value)}
            className="mt-1.5 h-8 w-full rounded-[8px] border border-line2 bg-panel2 px-2 text-[10.5px] text-ink"
          >
            {projects.map((projectOption) => (
              <option value={projectOption.id} key={projectOption.id}>
                {projectOption.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 grid gap-2">
          {specs.data?.items.map((item) => (
            <button
              type="button"
              key={item.spec.id}
              onClick={() => setActiveId(item.spec.id)}
              className={
                activeId === item.spec.id
                  ? "rounded-card border border-accent-strong bg-accent-soft p-3 text-left"
                  : "rounded-card border border-line bg-panel2 p-3 text-left"
              }
            >
              <strong className="text-[11.5px]">{item.spec.title}</strong>
              <span className="mt-1 block font-mono text-[9.5px] text-faint">
                {item.spec.status} · {item.revisions.length} versions
              </span>
            </button>
          ))}
        </div>
      </aside>
      <main className="overflow-auto p-[30px_34px_60px]">
        <div className="flex items-center gap-2">
          <select
            value={activeId}
            onChange={(event) => setActiveId(event.target.value)}
            className="h-8 rounded-[9px] border border-line2 bg-transparent px-2 text-[11px]"
          >
            <option value="new">New Spec</option>
            {specs.data?.items.map((item) => (
              <option value={item.spec.id} key={item.spec.id}>
                {item.spec.title}
              </option>
            ))}
          </select>
          <div className="flex rounded-[9px] bg-raise p-[3px]">
            <button
              type="button"
              onClick={() => setMode("preview")}
              className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[10.5px]"
            >
              <EyeIcon size={13} /> Full snapshot
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[10.5px]"
            >
              <CodeIcon size={13} /> New version
            </button>
          </div>
          <button
            type="button"
            disabled={!title.trim() || !markdown.trim() || publish.isPending}
            onClick={() => publish.mutate()}
            className="ml-auto h-8 rounded-btn bg-accent-strong px-3 text-[11px] font-[620] text-on-accent disabled:opacity-45"
          >
            Publish immutable version
          </button>
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={mode === "preview"}
          placeholder="Spec title"
          className="mt-6 w-full border-0 bg-transparent text-[27px] font-[560] tracking-[-0.03em] outline-none disabled:opacity-100"
        />
        {active ? (
          <div className="mt-4 flex gap-2">
            {active.revisions.map((revision) => (
              <button
                type="button"
                key={revision.id}
                onClick={() => setSelectedRevisionId(revision.id)}
                className={
                  selected?.id === revision.id
                    ? "rounded-[9px] border border-accent-strong bg-accent-soft px-3 py-2 font-mono text-[10px]"
                    : "rounded-[9px] border border-line bg-panel2 px-3 py-2 font-mono text-[10px]"
                }
              >
                v{revision.revision}
                {active.spec.confirmedRevisionId === revision.id
                  ? " · confirmed"
                  : ""}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-5 rounded-container border border-line bg-panel2 p-[34px_38px]">
          {mode === "preview" ? (
            <SafeMarkdown markdown={selected?.markdown ?? markdown} />
          ) : (
            <textarea
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              className="min-h-[560px] w-full resize-none bg-transparent font-mono text-[12px] leading-[1.8] outline-none"
            />
          )}
        </div>
      </main>
      <aside className="overflow-auto border-l border-line bg-panel p-6">
        <div className="rounded-card border border-line bg-panel2 p-4">
          <div className="flex items-center gap-2">
            <CheckCircleIcon size={15} className="text-green" />
            <strong className="text-[11.5px]">Version confirmation</strong>
          </div>
          <p className="mt-2 text-[10.5px] leading-[1.6] text-faint">
            {confirmationCount}/{active?.policy.requiredConfirmations ?? 1} ·
            version-specific
          </p>
          {active && current ? (
            <div className="mt-3 grid gap-2">
              {humanReviewers.length > 0 ? (
                <div className="rounded-[9px] bg-raise p-2.5">
                  <p className="text-[9.5px] text-faint">
                    Optional nominated reviewers
                  </p>
                  {humanReviewers.map((principal) => (
                    <label
                      key={principal.id}
                      className="mt-2 flex items-center gap-2 text-[10.5px]"
                    >
                      <input
                        type="checkbox"
                        checked={reviewerIds.includes(principal.id)}
                        onChange={(event) =>
                          setReviewerIds((currentIds) =>
                            event.target.checked
                              ? [...currentIds, principal.id]
                              : currentIds.filter(
                                  (id) => id !== principal.id,
                                ),
                          )
                        }
                      />
                      {principal.displayName}
                    </label>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                disabled={requestReview.isPending}
                onClick={() => requestReview.mutate()}
                className="h-8 rounded-btn border border-line2 text-[10.5px]"
              >
                Request review
              </button>
              <button
                type="button"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate()}
                className="h-8 rounded-btn bg-accent-strong text-[10.5px] text-on-accent"
              >
                Confirm this version
              </button>
              {requestReview.error || confirm.error ? (
                <p role="alert" className="text-[10px] leading-[1.5] text-danger">
                  {mutationMessage(requestReview.error ?? confirm.error)}
                </p>
              ) : null}
            </div>
          ) : null}
          {active ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[9.5px] text-faint">
                Effective Project review policy
              </p>
              <label className="mt-2 flex items-center justify-between text-[10.5px]">
                Confirmations
                <select
                  value={active.policy.requiredConfirmations}
                  disabled={!canGovern}
                  onChange={(event) =>
                    updatePolicy.mutate({
                      requiredConfirmations: Number(event.target.value),
                      otherMemberAgentsCount:
                        active.policy.otherMemberAgentsCount,
                      authorSelfConfirmation:
                        active.policy.authorSelfConfirmation,
                    })
                  }
                  className="h-7 rounded-[7px] border border-line2 bg-transparent px-2"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <PolicyCheck
                label="Other-member Agents count"
                checked={active.policy.otherMemberAgentsCount}
                disabled={!canGovern}
                onChange={(checked) =>
                  updatePolicy.mutate({
                    requiredConfirmations:
                      active.policy.requiredConfirmations,
                    otherMemberAgentsCount: checked,
                    authorSelfConfirmation:
                      active.policy.authorSelfConfirmation,
                  })
                }
              />
              <PolicyCheck
                label="Author self-confirmation"
                checked={active.policy.authorSelfConfirmation}
                disabled={!canGovern}
                onChange={(checked) =>
                  updatePolicy.mutate({
                    requiredConfirmations:
                      active.policy.requiredConfirmations,
                    otherMemberAgentsCount:
                      active.policy.otherMemberAgentsCount,
                    authorSelfConfirmation: checked,
                  })
                }
              />
            </div>
          ) : null}
        </div>

        <div className="mt-5">
          <div className="flex items-center gap-2">
            <ChatCircleIcon size={15} />
            <strong className="text-[11.5px]">Inline comments</strong>
          </div>
          <p className="mt-1.5 text-[10.5px] text-faint">
            Bound only to the selected immutable version; no re-anchoring.
          </p>
          <div className="mt-3 grid gap-2">
            {threads.map((thread) => (
              <article
                key={thread.id}
                className="rounded-card border border-line bg-panel2 p-3"
              >
                <div className="font-mono text-[9.5px] text-faint">
                  Lines {thread.lineStart}–{thread.lineEnd} · {thread.status}
                </div>
                {thread.comments.map((entry) => (
                  <p
                    key={entry.id}
                    className="mt-2 text-[11.5px] leading-[1.6]"
                  >
                    {entry.body}
                  </p>
                ))}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReplyThreadId(thread.id);
                      setComment("");
                    }}
                    className="text-[9.5px] text-accent-strong"
                  >
                    Reply
                  </button>
                  <button
                    type="button"
                    disabled={setThreadStatus.isPending}
                    onClick={() =>
                      setThreadStatus.mutate({
                        threadId: thread.id,
                        status:
                          thread.status === "open" ? "resolved" : "open",
                      })
                    }
                    className="text-[9.5px] text-faint"
                  >
                    {thread.status === "open" ? "Resolve" : "Reopen"}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {active && selected ? (
            <div className="mt-3 grid gap-2 rounded-card bg-raise p-3">
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={lineStart}
                  onChange={(event) => setLineStart(Number(event.target.value))}
                  className="h-7 w-16 rounded-[7px] border border-line2 bg-transparent px-2 text-[10px]"
                />
                <input
                  type="number"
                  min={lineStart}
                  value={lineEnd}
                  onChange={(event) => setLineEnd(Number(event.target.value))}
                  className="h-7 w-16 rounded-[7px] border border-line2 bg-transparent px-2 text-[10px]"
                />
              </div>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={
                  replyThreadId
                    ? "Reply to selected thread"
                    : "Comment on this full snapshot"
                }
                className="min-h-20 resize-none rounded-[8px] border border-line2 bg-transparent p-2 text-[11px]"
              />
              <button
                type="button"
                disabled={!comment.trim() || addComment.isPending}
                onClick={() => addComment.mutate()}
                className="h-8 rounded-btn bg-accent-strong text-[10.5px] text-on-accent disabled:opacity-45"
              >
                Add comment
              </button>
              {addComment.error ? (
                <p role="alert" className="text-[10px] leading-[1.5] text-danger">
                  {mutationMessage(addComment.error)}
                </p>
              ) : null}
              {replyThreadId ? (
                <button
                  type="button"
                  onClick={() => setReplyThreadId(undefined)}
                  className="text-[9.5px] text-faint"
                >
                  Cancel reply
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function mutationMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The action could not be completed.";
}

function PolicyCheck({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mt-2 flex items-center justify-between gap-3 text-[10.5px]">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
