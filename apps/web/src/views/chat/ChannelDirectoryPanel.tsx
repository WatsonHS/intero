import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { TeamRoomDirectoryItem } from "@intero/domain";

import { getTeamRooms, joinThread, leaveThread } from "../../api.js";
import { Modal } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";

export function ChannelDirectoryPanel({
  teams,
  onClose,
  onJoined,
  onLeft,
}: {
  teams: Array<{ id: string; name: string }>;
  onClose(): void;
  onJoined(threadId: string): void;
  onLeft(threadId: string): void;
}) {
  const { formatRelative, t } = useI18n();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id);
  const resolvedTeamId = teamId ?? teams[0]?.id;
  const rooms = useQuery({
    queryKey: ["team-rooms", resolvedTeamId],
    queryFn: ({ signal }) =>
      getTeamRooms(resolvedTeamId!, { includeJoined: true }, signal),
    enabled: Boolean(resolvedTeamId),
  });
  const join = useMutation({
    mutationFn: joinThread,
    onSuccess: async ({ thread }) => {
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      await queryClient.invalidateQueries({ queryKey: ["team-rooms"] });
      onJoined(thread.id);
    },
  });
  const leave = useMutation({
    mutationFn: leaveThread,
    onSuccess: async (_result, threadId) => {
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      await queryClient.invalidateQueries({ queryKey: ["team-rooms"] });
      onLeft(threadId);
    },
  });
  const needle = query.trim().toLocaleLowerCase();
  const items = useMemo(
    () =>
      (rooms.data?.items ?? []).filter((item) =>
        needle ? item.thread.title.toLocaleLowerCase().includes(needle) : true,
      ),
    [needle, rooms.data?.items],
  );

  return (
    <Modal
      title={t("chat.channelDirectory")}
      onClose={onClose}
      width={480}
      testId="channel-directory"
    >
      {teams.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              data-testid={`channel-team-${team.id}`}
              onClick={() => setTeamId(team.id)}
              className={
                resolvedTeamId === team.id
                  ? "h-7 rounded-pill border-0 bg-sel px-2.5 text-[11px]"
                  : "h-7 rounded-pill border border-line2 bg-transparent px-2.5 text-[11px] text-ink-muted"
              }
            >
              {team.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex h-[34px] items-center gap-2 rounded-inset border border-line bg-raise px-[11px]">
        <MagnifyingGlassIcon size={13} className="text-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("chat.channelSearch")}
          aria-label={t("chat.channelSearch")}
          className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
        />
      </div>
      <div className="mt-3 grid gap-1">
        {items.map((item) => (
          <ChannelDirectoryRow
            key={item.thread.id}
            item={item}
            busy={
              (join.isPending && join.variables === item.thread.id) ||
              (leave.isPending && leave.variables === item.thread.id)
            }
            formatRelative={formatRelative}
            memberLabel={t("chat.memberCountShort", {
              count: item.memberCount,
            })}
            joinLabel={t("chat.join")}
            leaveLabel={t("chat.leave")}
            joinedLabel={t("chat.joined")}
            onJoin={() => join.mutate(item.thread.id)}
            onLeave={() => leave.mutate(item.thread.id)}
          />
        ))}
        {items.length === 0 ? (
          <div className="px-[9px] py-3.5 text-[11.5px] text-faint">
            {t("chat.noChannels")}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function ChannelDirectoryRow({
  item,
  busy,
  formatRelative,
  memberLabel,
  joinLabel,
  leaveLabel,
  joinedLabel,
  onJoin,
  onLeave,
}: {
  item: TeamRoomDirectoryItem;
  busy: boolean;
  formatRelative: (value: string) => string;
  memberLabel: string;
  joinLabel: string;
  leaveLabel: string;
  joinedLabel: string;
  onJoin(): void;
  onLeave(): void;
}) {
  return (
    <div
      data-testid={`channel-row-${item.thread.id}`}
      data-channel-title={item.thread.title}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-inset px-[9px] py-2"
    >
      <div className="grid min-w-0 gap-0.5">
        <strong className="truncate text-[12.5px] font-[570]">
          #{item.thread.title.replace(/^#/, "")}
        </strong>
        <span className="truncate text-[10.5px] text-faint">
          {memberLabel}
          {item.latestMessageAt
            ? ` · ${formatRelative(item.latestMessageAt)}`
            : ""}
        </span>
      </div>
      {item.joined ? (
        <button
          type="button"
          data-testid="channel-leave"
          disabled={busy}
          onClick={onLeave}
          className="h-7 rounded-btn border border-line2 bg-transparent px-2.5 text-[11px] text-ink-muted hover:border-danger hover:text-danger disabled:opacity-50"
        >
          {busy ? joinedLabel : leaveLabel}
        </button>
      ) : (
        <button
          type="button"
          data-testid="channel-join"
          disabled={busy}
          onClick={onJoin}
          className="h-7 rounded-btn border-0 bg-accent-strong px-2.5 text-[11px] font-[620] text-on-accent disabled:opacity-50"
        >
          {joinLabel}
        </button>
      )}
    </div>
  );
}
