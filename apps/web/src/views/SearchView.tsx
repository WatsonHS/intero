import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  applySearchFilter,
  type AuthorizedSearchResult,
  parseSearchQuery,
  stripSearchFilter,
} from "@intero/domain";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { searchAuthorizedContent } from "../api.js";
import { Avatar } from "../design/primitives.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";
import type { PilotTeamPayload } from "../pilot/api.js";
import { usePilotOptional } from "../pilot/context.js";
import { HighlightedSnippet } from "./search/HighlightedSnippet.js";

const CONTENT_FILTERS: Array<{
  id: Exclude<AuthorizedSearchResult["type"], "message">;
  label: TranslationKey;
}> = [
  { id: "work_item", label: "search.type.work_item" },
  { id: "spec", label: "search.type.spec" },
  { id: "spec_version", label: "search.type.spec_version" },
  { id: "comment", label: "search.type.comment" },
  { id: "code_reference", label: "search.type.code_reference" },
  { id: "coordination", label: "search.type.coordination" },
  { id: "stand_in_activity", label: "search.type.stand_in_activity" },
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
  const { t, formatDate, formatTime } = useI18n();
  const pilot = usePilotOptional();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"content" | "messages">("content");
  const [types, setTypes] = useState<AuthorizedSearchResult["type"][]>([]);
  const [projectId, setProjectId] = useState("");
  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const requestedTypes =
    tab === "messages"
      ? (["message"] as AuthorizedSearchResult["type"][])
      : types.length
        ? types
        : CONTENT_FILTERS.map((filter) => filter.id);
  const canSearch =
    query.trim().length >= 2 ||
    Boolean(parsed.inThreadId) ||
    Boolean(parsed.inTitle) ||
    Boolean(parsed.fromPrincipalId) ||
    Boolean(parsed.fromDisplayName) ||
    Boolean(parsed.before) ||
    Boolean(parsed.after) ||
    Boolean(parsed.hasAttachment);
  const results = useQuery({
    queryKey: ["authorized-search", tab, query, projectId, requestedTypes],
    queryFn: ({ signal }) =>
      searchAuthorizedContent(
        {
          query,
          ...(projectId && tab === "content" ? { projectId } : {}),
          ...(requestedTypes.length ? { types: requestedTypes } : {}),
        },
        signal,
      ),
    enabled: canSearch,
    staleTime: 5_000,
  });
  const contacts = searchTeamContacts(
    pilot?.teams.data?.teams ?? [],
    pilot?.identityId,
    parseSearchQuery(query).text || query,
  );
  const principalNames = new Map(
    (pilot?.teams.data?.teams ?? []).flatMap((team) =>
      team.members.map((member) => [member.id, member.displayName] as const),
    ),
  );

  return (
    <div className="h-full overflow-y-auto px-[clamp(24px,4vw,64px)] py-8">
      <header>
        <p className="text-[10px] font-[650] tracking-[0.12em] text-accent-strong">
          SEARCH
        </p>
        <h1 className="mt-2 text-[25px] font-[560] tracking-[-0.035em]">
          {t("search.title")}
        </h1>
        <p className="mt-2 text-[12px] leading-[1.7] text-ink-muted">
          {t("search.lede")}
        </p>
      </header>

      <div className="mt-6 flex h-11 items-center gap-3 rounded-[12px] border border-line2 bg-raise px-4 focus-within:border-accent-strong">
        <MagnifyingGlassIcon size={16} className="text-faint" />
        <input
          autoFocus
          data-testid="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            tab === "messages"
              ? t("search.placeholderMessages")
              : t("search.placeholder")
          }
          title={t("search.syntaxHint")}
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
        />
        {tab === "content" ? (
          <select
            aria-label={t("search.projectScope")}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="h-8 rounded-btn border border-line bg-panel px-2 text-[10.5px] text-ink-muted"
          >
            <option value="">{t("search.allProjects")}</option>
            {(pilot?.projects.data?.projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="mt-3 flex gap-2">
        {(["content", "messages"] as const).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`search-tab-${id}`}
            onClick={() => setTab(id)}
            className={[
              "h-8 rounded-full border px-3 text-[11px]",
              tab === id
                ? "border-accent-strong bg-accent-soft text-accent-strong"
                : "border-line bg-panel2 text-faint",
            ].join(" ")}
          >
            {t(id === "content" ? "search.tab.content" : "search.tab.messages")}
          </button>
        ))}
      </div>

      {tab === "content" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {CONTENT_FILTERS.map((filter) => {
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
                {t(filter.label)}
              </button>
            );
          })}
        </div>
      ) : (
        <MessageFilterChips query={query} onChange={setQuery} />
      )}

      <section className="mt-6 grid gap-2.5">
        {!canSearch ? (
          <SearchEmpty text={t("search.minChars")} />
        ) : tab === "messages" ? (
          results.isLoading ? (
            <SearchEmpty text={t("search.searching")} />
          ) : results.data?.items.length ? (
            results.data.items.map((result) => (
              <button
                key={`${result.type}:${result.id}`}
                type="button"
                data-testid="search-result"
                data-message-id={result.messageId}
                data-thread-id={result.threadId}
                onClick={() => onOpenResult(result)}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-[13px] border border-line bg-panel2 p-[14px_16px] text-left hover:border-line2 hover:bg-raise"
              >
                <span className="min-w-0">
                  <span className="text-[9.5px] font-[650] tracking-[0.07em] text-accent-strong">
                    {t("search.tab.messages")}
                    {" · "}
                    {result.title}
                  </span>
                  <strong className="mt-1.5 block truncate text-[12.5px] font-[620]">
                    {(result.senderId
                      ? principalNames.get(result.senderId)
                      : undefined) ?? t("search.unknownSender")}
                  </strong>
                  <HighlightedSnippet snippet={result.snippet} />
                </span>
                <time className="text-[9.5px] text-faint">
                  {result.createdAt
                    ? `${formatDate(result.createdAt)} ${formatTime(result.createdAt)}`
                    : formatDate(result.updatedAt)}
                </time>
              </button>
            ))
          ) : (
            <SearchEmpty text={t("search.emptyMessages")} />
          )
        ) : (
          <>
            {contacts.length > 0 ? (
              <div className="mb-3 grid gap-2.5">
                <strong className="text-[11px] font-[650] tracking-[0.08em] text-faint">
                  {t("search.contacts")}
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
                {t("search.content")}
              </strong>
            ) : null}
            {results.isLoading ? (
              <SearchEmpty text={t("search.searching")} />
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
                      {t(
                        CONTENT_FILTERS.find((item) => item.id === result.type)
                          ?.label ?? "search.tab.content",
                      )}
                      {result.projectName ? ` · ${result.projectName}` : ""}
                    </span>
                    <strong className="mt-1.5 block truncate text-[12.5px] font-[620]">
                      {result.title}
                    </strong>
                    <HighlightedSnippet snippet={result.snippet} />
                  </span>
                  <time className="text-[9.5px] text-faint">
                    {formatDate(result.updatedAt)}
                  </time>
                </button>
              ))
            ) : contacts.length === 0 ? (
              <SearchEmpty text={t("search.empty")} />
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function MessageFilterChips({
  query,
  onChange,
}: {
  query: string;
  onChange(next: string): void;
}) {
  const { t } = useI18n();
  const parsed = parseSearchQuery(query);
  const fromValue = parsed.fromDisplayName ?? parsed.fromPrincipalId ?? "";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="flex h-7 items-center gap-1.5 rounded-full border border-line bg-panel2 px-2.5 text-[10px] text-faint">
        {t("search.filter.from")}
        <input
          value={fromValue}
          onChange={(event) =>
            onChange(
              event.target.value
                ? applySearchFilter(query, "from", event.target.value)
                : stripSearchFilter(query, "from"),
            )
          }
          placeholder={t("search.filter.fromPlaceholder")}
          className="w-[88px] border-0 bg-transparent text-[10px] text-ink outline-none placeholder:text-faint"
        />
      </label>
      <label className="flex h-7 items-center gap-1.5 rounded-full border border-line bg-panel2 px-2.5 text-[10px] text-faint">
        {t("search.filter.after")}
        <input
          type="date"
          value={parsed.after ?? ""}
          onChange={(event) =>
            onChange(
              event.target.value
                ? applySearchFilter(query, "after", event.target.value)
                : stripSearchFilter(query, "after"),
            )
          }
          className="border-0 bg-transparent text-[10px] text-ink outline-none"
        />
      </label>
      <label className="flex h-7 items-center gap-1.5 rounded-full border border-line bg-panel2 px-2.5 text-[10px] text-faint">
        {t("search.filter.before")}
        <input
          type="date"
          value={parsed.before ?? ""}
          onChange={(event) =>
            onChange(
              event.target.value
                ? applySearchFilter(query, "before", event.target.value)
                : stripSearchFilter(query, "before"),
            )
          }
          className="border-0 bg-transparent text-[10px] text-ink outline-none"
        />
      </label>
      <button
        type="button"
        onClick={() =>
          onChange(
            parsed.hasAttachment
              ? stripSearchFilter(query, "has")
              : applySearchFilter(query, "has", "attachment"),
          )
        }
        className={[
          "h-7 rounded-full border px-3 text-[10px]",
          parsed.hasAttachment
            ? "border-accent-strong bg-accent-soft text-accent-strong"
            : "border-line bg-panel2 text-faint",
        ].join(" ")}
      >
        {t("search.filter.hasAttachment")}
      </button>
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
