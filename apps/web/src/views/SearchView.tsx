import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import type { AuthorizedSearchResult } from "@intero/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { searchAuthorizedContent } from "../api.js";
import { Avatar } from "../design/primitives.js";
import type { PilotTeamPayload } from "../pilot/api.js";
import { usePilotOptional } from "../pilot/context.js";

const FILTERS: Array<{
  id: AuthorizedSearchResult["type"];
  label: string;
}> = [
  { id: "work_item", label: "工作项" },
  { id: "spec", label: "Spec" },
  { id: "spec_version", label: "Spec 版本" },
  { id: "comment", label: "评论" },
  { id: "code_reference", label: "代码引用" },
  { id: "coordination", label: "协调" },
  { id: "stand_in_activity", label: "替身活动" },
];

export function searchTeamContacts(
  teams: PilotTeamPayload[],
  currentIdentityId: string | undefined,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  return [
    ...new Map(
      teams.flatMap((team) =>
        team.members
          .filter(
            (member) =>
              member.kind === "human" && member.id !== currentIdentityId,
          )
          .map(
            (member) =>
              [
                member.id,
                {
                  id: member.id,
                  displayName: member.displayName,
                  email: member.email,
                  teamName: team.name,
                },
              ] as const,
          ),
      ),
    ).values(),
  ].filter(
    (contact) =>
      contact.displayName.toLocaleLowerCase().includes(needle) ||
      contact.email.toLocaleLowerCase().includes(needle) ||
      contact.teamName.toLocaleLowerCase().includes(needle),
  );
}

export function SearchView({
  onOpenResult,
  onOpenPerson,
}: {
  onOpenResult: (result: AuthorizedSearchResult) => void;
  onOpenPerson: (ownerId: string) => void;
}) {
  const pilot = usePilotOptional();
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<AuthorizedSearchResult["type"][]>([]);
  const [projectId, setProjectId] = useState("");
  const results = useQuery({
    queryKey: ["authorized-search", query, projectId, types],
    queryFn: ({ signal }) =>
      searchAuthorizedContent(
        {
          query,
          ...(projectId ? { projectId } : {}),
          ...(types.length ? { types } : {}),
        },
        signal,
      ),
    enabled: query.trim().length >= 2,
    staleTime: 5_000,
  });
  const contacts = searchTeamContacts(
    pilot?.teams.data?.teams ?? [],
    pilot?.identityId,
    query,
  );

  return (
    <div className="h-full overflow-y-auto px-[clamp(24px,4vw,64px)] py-8">
      <header>
        <p className="text-[10px] font-[650] tracking-[0.12em] text-accent-strong">
          SEARCH
        </p>
        <h1 className="mt-2 text-[25px] font-[560] tracking-[-0.035em]">
          搜索联系人和你有权限看到的内容
        </h1>
        <p className="mt-2 text-[12px] leading-[1.7] text-ink-muted">
          搜索联系人、工作项、Spec、评论、显式代码引用、协调和你的替身活动。私有原始内容不会进入结果。
        </p>
      </header>

      <div className="mt-6 flex h-11 items-center gap-3 rounded-[12px] border border-line2 bg-raise px-4 focus-within:border-accent-strong">
        <MagnifyingGlassIcon size={16} className="text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入至少两个字符"
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
        />
        <select
          aria-label="项目范围"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="h-8 rounded-btn border border-line bg-panel px-2 text-[10.5px] text-ink-muted"
        >
          <option value="">所有可访问项目</option>
          {(pilot?.projects.data?.projects ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const active = types.includes(filter.id);
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() =>
                setTypes((current) =>
                  active
                    ? current.filter((item) => item !== filter.id)
                    : [...current, filter.id],
                )
              }
              className={[
                "h-7 rounded-full border px-3 text-[10px]",
                active
                  ? "border-accent-strong bg-accent-soft text-accent-strong"
                  : "border-line bg-panel2 text-faint",
              ].join(" ")}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      <section className="mt-6 grid gap-2.5">
        {query.trim().length < 2 ? (
          <SearchEmpty text="输入关键词开始搜索" />
        ) : (
          <>
            {contacts.length > 0 ? (
              <div className="mb-3 grid gap-2.5">
                <strong className="text-[11px] font-[650] tracking-[0.08em] text-faint">
                  联系人
                </strong>
                {contacts.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    data-testid={`contact-search-result-${contact.id}`}
                    onClick={() => onOpenPerson(contact.id)}
                    className="grid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 rounded-[13px] border border-line bg-panel2 p-[12px_16px] text-left hover:border-line2 hover:bg-raise"
                  >
                    <Avatar
                      id={contact.id}
                      name={contact.displayName}
                      size="lg"
                    />
                    <span className="min-w-0">
                      <strong className="block truncate text-[12.5px] font-[620]">
                        {contact.displayName}
                      </strong>
                      <span className="mt-1 block truncate text-[10.5px] text-ink-muted">
                        {contact.email}
                      </span>
                    </span>
                    <span className="text-[10px] text-faint">
                      {contact.teamName}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {contacts.length > 0 ? (
              <strong className="text-[11px] font-[650] tracking-[0.08em] text-faint">
                内容
              </strong>
            ) : null}
            {results.isLoading ? (
              <SearchEmpty text="正在搜索…" />
            ) : results.data?.items.length ? (
              results.data.items.map((result) => (
                <button
                  key={`${result.type}:${result.id}`}
                  type="button"
                  onClick={() => onOpenResult(result)}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-[13px] border border-line bg-panel2 p-[14px_16px] text-left hover:border-line2 hover:bg-raise"
                >
                  <span className="min-w-0">
                    <span className="text-[9.5px] font-[650] tracking-[0.07em] text-accent-strong">
                      {FILTERS.find((item) => item.id === result.type)?.label ??
                        result.type}
                      {" · "}
                      {result.projectName}
                    </span>
                    <strong className="mt-1.5 block truncate text-[12.5px] font-[620]">
                      {result.title}
                    </strong>
                    <span className="mt-1 block line-clamp-2 text-[11px] leading-[1.6] text-ink-muted">
                      {result.snippet}
                    </span>
                  </span>
                  <time className="text-[9.5px] text-faint">
                    {new Date(result.updatedAt).toLocaleDateString()}
                  </time>
                </button>
              ))
            ) : contacts.length === 0 ? (
              <SearchEmpty text="没有匹配的联系人或授权内容" />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function SearchEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-[13px] border border-dashed border-line2 bg-panel2 px-5 py-12 text-center text-[11.5px] text-faint">
      {text}
    </div>
  );
}
