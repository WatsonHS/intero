---
date: 2026-09-03
topic: competitive-landscape
---

# Intero 竞品对比与借鉴清单

## 摘要

把 Intero 和 TabTin 以及 awesome-agent-orchestrators 收录的 150 多个项目放在一起看：
赛道里没有一个项目做“跨人跨 Agent 的冲突检测 + 有界升级 + 人确认 + 回流”，这个空位是真的。
Intero 的优势是结构性的：不做执行层、隐私边界最严、Claim 模型和来源类型是 schema 而不是口号。
劣势是市场性的：分发为零、单人冷启动无价值、数据依赖 Agent 配合上报。
本文列出可直接映射到现有对象的借鉴项，按收益除以成本排序。

产品定位按 README：Intero 是 AI-native 的协作平台，聊天是入口不是附属。
协调层是差异化来源，不是产品边界。所以聊天、通话、文档这类通用协作功能在范围内，
借鉴清单相应包含协作套件的项目。

## 范围

- 对比对象：[TabTin](https://github.com/tabtin-ai/TabTin)，以及
  [awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators)
  收录的赛道项目，重点看 Entire、Beads、Symphony。
- 协作套件参考：Zulip、Slack、Campfire，只看数据模型和交互，不看规模。
- 不含：Zenova-mono 的拆分接入。那是另一份讨论。
- 数据截止：2026-09-03。TabTin 数字来自 GitHub API 当日快照。

## 1. TabTin 对比

### 1.1 定位与核心模型

| 维度         | Intero                                                                              | TabTin                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 一句话       | 软件团队 + Coding Agent 的协调 / interoception 层                                   | 人与多 Agent 共同工作的 workspace                                                                                   |
| 目标用户     | 用 Claude Code / Codex / Cursor 的研发团队                                          | 个人和团队的通用知识工作，含研究、文档、代码                                                                        |
| Agent 在哪跑 | 外部（Codex、Claude Code、OpenCode、Cursor、Grok Build），通过认证 MCP 上报         | 自带 agent-runtime，默认跑在用户桌面 + daemon；手机端只是伴随界面                                                   |
| Agent 角色   | 两个：个人 Stand-in（“我”）、Room 里的 Intero（“我们”）                             | 可配置身份：role + rules + models + skills + memory                                                                 |
| 数据入口     | 语义 checkpoint、授权聊天；明确拒收 prompt / diff / 文件 / 终端日志                 | Workspace 持有文件、终端、浏览器、Checkpoint，Agent 直接操作                                                        |
| 核心对象     | Room、Work State、Claim、Coordination Thread、Action Inbox、Spec Review、Team Pulse | Organization、Workspace、Agent、App（doc / table / slide / terminal / browser）、Task continuation、Handoff package |
| 关键承诺     | 兼容工作保持安静；有证据的冲突才开有界讨论；人确认最终决策                          | 一个人用 Agent 做完的工作可以成为同事的起点；过程可见、结果可复核、方法可复用                                       |

### 1.2 技术栈与规模

| 维度            | Intero                                                                         | TabTin                                                                      |
| --------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 后端            | Fastify + Drizzle + Zod，PostgreSQL（RLS）+ SpiceDB + Graphile Worker + outbox | Django（Python）+ Node collab-live                                          |
| 实时            | Centrifugo                                                                     | Centrifugo                                                                  |
| 前端            | React 19 + Vite + TanStack Router / Query + Tailwind 4                         | React + Electron；iOS（Swift）、Android（Kotlin）                           |
| 模型接入        | Vercel AI SDK，openai-compatible，管理员配置                                   | 多模型 + 用量统计，BYOK                                                     |
| 客户端          | web、可选 Electron、mcp-stdio                                                  | electron、web、iOS、Android、daemon、admindash、Go CLI、Python SDK          |
| apps / packages | 5 / 9                                                                          | 8 / 90                                                                      |
| 代码量          | 约 114k 行 TS                                                                  | TS 78MB、Python 48MB、Kotlin 10MB、Swift 9MB、Go 2MB                        |
| 历史            | 114 commits，2026-07-24 起                                                     | 公开于 2026-08-19，私有历史未公开；256 stars、57 forks                      |
| 许可            | Apache-2.0                                                                     | AGPL-3.0 + 商业授权（上海墨帆科技）                                         |
| 状态            | pre-1.0，支持 pilot 部署，有 production compose 和 ops 脚本                    | Public Preview；CHANGELOG 写“首个公开版本仍在验证”；Community Server 仅本地 |

TabTin 90 个 package 里一半是执行基础设施：pty-core、browser-core、lsp-runtime、
python-runtime、table-kernel-pglite、crawl、anti-detect、safe-fs。Intero 全部没有，
因为把执行留给外部 Agent。

### 1.3 重叠与风险

- TabTin roadmap 下一阶段明确写“Project 为主要焦点”“task handoff、method reuse、
  governance”。它从“我执行 Agent”一侧进入项目管理，会和 Intero 的 Project /
  Spec Review / Coordination 撞到一起。
- Intero 的差异化：不要求团队换执行环境；协调信号来自 git / CI / test 证据而不是
  Agent 自己的输出；隐私边界写进数据模型。TabTin 的 handoff 是“冻结上下文整包转交”，
  Intero 是“只共享授权语义状态”。
- TabTin 有而 Intero 没有：手机端、协作文档 / 表格 / 幻灯片、Agent 角色配置、云托管服务和官网。
- Intero 有而 TabTin 没有：ReBAC + RLS 双层授权、事务 outbox 保证的幂等后台任务、
  evidence-gate 路线图和 ADR、Golden Case 端到端验收、生产运维脚本。

## 2. 赛道分层

| 层                | 代表                                        | 做什么                                              | 不做什么            |
| ----------------- | ------------------------------------------- | --------------------------------------------------- | ------------------- |
| 单人并行编排      | vibe-kanban、Conductor、claude-squad 等 50+ | worktree 隔离、多 Agent 并跑、diff 审查             | 团队、跨人协调      |
| Agent 记忆 / 追溯 | Beads（26.8k ★）、Entire（5.1k ★）          | 依赖图 issue、checkpoint 绑 commit、transcript 检索 | 判断“谁需要知道”    |
| Tracker 作控制面  | Symphony、cyrus、sortie                     | Linear issue → 沙箱 → PR                            | 结果回流、冲突发现  |
| 团队 workspace    | TabTin、paperclip、centaur、qm              | 自己跑 Agent，共享结果                              | 接现有 Coding Agent |
| 协调层            | Intero                                      | 从多人多 Agent 的语义状态判断要不要打扰谁           | 执行、存原文        |

列表标 team-oriented 的约 30 个项目里，最接近 Intero 定位的两个：

- qm：“multiplayer harness where teammates run agents independently”。
- codecast：“watches sessions surfacing them in live triage inbox with attribution”，
  和 Action Inbox 接近。

## 3. Intero 的优势

按代码里实际存在的东西说：

1. **Claim 模型比同类细。** `PilotSharedBoundaryClaim` 有 kind、relation、assumption、
   change（additive / compatible / breaking）、preserves；匹配结果分 compatible /
   potential_conflict / insufficient_evidence。Beads 只有 blocks / related，Entire 没有语义层。
2. **来源类型是一等字段。** `ClaimSourceType` 区分 human_statement、human_correction、
   direct_observation、coding_agent_report、project_system、stand_in_inference。
   “对话是信号不是真理”在同类项目里是口号，在 Intero 是 schema。
3. **隐私边界最严。** Entire 存全 transcript，脱敏 best-effort，shadow branch 保留原文；
   Beads 存 issue 文本；TabTin 存文件和终端。Intero 只收语义 checkpoint。
   这是企业安全审查能过的唯一一档。
4. **升级阶梯和去重。** ambient → relevance → action → confirmed；重复信号更新同一路径，
   不新建 Thread / 消息 / Inbox 项。Symphony 类是 issue → Agent 单向，没有回流。
5. **不做执行层。** 执行层由 Claude Code / Codex / Cursor 竞争，Intero 骑在它们上面。
   只要 MCP 保持开放，位置就成立。

## 4. Intero 的劣势

1. **分发为零。** 114 commits，未公开，无官网、无云服务、无手机端。
2. **冷启动。** 价值只在多人多 Agent 并行且发生冲突时显现。单人用户第一天什么都得不到。
   TabTin、Beads、Entire 单人当天就有收获。
3. **数据依赖对方配合。** Agent 不装 MCP、不打 checkpoint，Intero 就是盲的。
4. **可被平台吸收。** “协调层”是 Linear / GitHub / Slack 加一个功能就能覆盖的东西。
   护城河取决于冲突检测质量，不是架构。
5. **聊天要达到团队愿意搬进来的门槛。** 聊天是入口，团队不搬进来，协调层就收不到对话信号。
   现有域模型已有 thread、已读状态、附件、reaction、mention、引用回复、浏览器通知。
   缺全文搜索、手机端和离线推送、文件预览、外部集成。做到一半的聊天没有人用，
   这比“做不做聊天”更关键。

## 5. 借鉴清单

按收益除以成本排序。“对象”列指 Intero 里承接该机制的现有对象。

| #   | 来源             | 机制                                                           | 对象                          | 成本 |
| --- | ---------------- | -------------------------------------------------------------- | ----------------------------- | ---- |
| 1   | Entire           | commit trailer + 独立 git ref 作为 checkpoint 锚点             | Work State、`evidenceRefs`    | 低   |
| 2   | Beads            | `ready` 派生视图、`--claim` 原子领取、`discovered_from` 关系   | `WorkRelationKind`、Work Item | 低   |
| 3   | Beads            | `prime`：开工时注入项目记忆                                    | Stand-in                      | 中   |
| 4   | 赛道共性         | local-first、一行安装、零服务端                                | `mcp-stdio`                   | 中   |
| 5   | TabTin           | Handoff package                                                | Coordination Thread 关闭产物  | 低   |
| 6   | TabTin           | Agent 角色可配置                                               | Stand-in                      | 中   |
| 7   | Entire           | 8 家 Agent 的 hook 目录约定                                    | `packages/integrations`       | 低   |
| 8   | Symphony / cyrus | issue → PR 生命周期作为上游信号                                | Action Inbox 证据源           | 中   |
| 9   | Beads            | AGENTS.md 约定文本密度                                         | `buildConnectPrompt`          | 低   |
| 10  | TabTin           | 中英双份 SECURITY / CONTRIBUTING / CHANGELOG                   | 仓库根目录                    | 低   |
| 11  | Zulip            | topic-first 线程模型：消息必属于一个可解决、可移动的 topic     | Room、Coordination Thread     | 中   |
| 12  | TabTin           | App 模型：消息、文档、表格是同一协作面，Agent 和人编辑同一结果 | Spec Review → 通用协作文档    | 高   |
| 13  | Slack            | 搜索、Huddles、unread 优先的导航                               | 聊天入口                      | 高   |

### 5.1 Entire 的 git 锚点

Entire 在 commit message 写 `Entire-Checkpoint: <id>` trailer，checkpoint 存在
`refs/entire/checkpoints/<shard>/<id>`，不进分支历史，可独立 push / fetch。

Intero 的 `PilotCheckpointInput.evidenceRefs` 是自由字符串，Work State 没有 commit sha
和 branch 字段。抄法：

- Work State 增加 commit / branch / repository 字段；
- Coding Agent 提交时写 `Intero-Checkpoint: <clientEventId>` trailer；
- 不存 transcript，不改隐私边界。

效果：证据从字符串变成可反查引用，CI 和 PR 能对上 checkpoint。这是最值的一条。

### 5.2 Beads 的依赖图操作

- `bd ready`：从依赖图算出无未关闭阻塞的可领工作。
- `bd update <id> --claim`：一步设 assignee + in_progress，减少竞争。
- 关系类型：blocks、related、parent-child、discovered-from。

Intero `WorkRelationKind` 只有 blocks / blocked_by / related / duplicate / duplicated_by。
加 `discovered_from` 直接承接 provenance 论点；加 parent / child 承接 Epic → Feature →
Work Item 层级；`ready` 作为派生视图不需要新表。

### 5.3 Beads 的 prime

`bd prime` 在 Agent 会话开始时注入项目记忆，替代散落的 MEMORY.md。

对应 Intero：Stand-in 给 Coding Agent 的“开工简报”，内容是上次做到哪、哪些 Claim
还活着、谁在改相邻边界。这是 Stand-in 单人价值的落点，也是解决第 4 节劣势 2 的办法。

### 5.4 零基础设施试用模式

赛道几乎全部 local-first，`npx` 一行起，不需要服务端。Intero 要起 Postgres + SpiceDB +
Centrifugo + MinIO。

抄法：`apps/mcp-stdio` 加单机模式，pglite 存储，跳过 SpiceDB 和 Centrifugo。
单人试用不用 Docker。和 5.3 是同一件事的两半。

### 5.5 TabTin 的 Handoff package

结构化对象：目标、进度、下一步、风险、引用资源（沿用原权限）。

对应 Intero：Coordination Thread 关闭时的产物，以及 Work State 的对外摘要格式。
和现有模型零冲突。不抄它“冻结原始文件”的部分。

### 5.6 TabTin 的 Agent 角色配置

TabTin 的 Agent 有 role / rules / models / skills / memory。

只抄到 Stand-in 上：让人配置“我的 Stand-in 怎么总结、能分享什么、用哪个模型”。
不做通用 Agent 角色系统。

### 5.7 Entire 的 hook 覆盖面

Entire 接 Claude Code、Codex、Copilot CLI、Cursor、Factory Droid、Gemini CLI、
OpenCode、Pi 共 8 家，按 `.claude/`、`.codex/` 各目录放 hook 配置。Intero 5 家。
`packages/integrations` 的 installer 已经是这个思路，补 3 家即可。

### 5.8 Symphony 的生命周期作为上游信号

Symphony 把 Linear issue 映射到隔离工作区，30 秒轮询，崩溃重启，跑出 PR。
Intero 不做执行，但可以把 Symphony / cyrus / sortie 产出的 issue → PR 当 Action Inbox
的证据源接进来。它们不做回流，Intero 做。

### 5.9 Beads 的约定文本

`bd init` 生成的 AGENTS.md 只有五行命令和一句“别用 markdown TODO”。
Intero `buildConnectPrompt` 偏长，学它的密度。

### 5.10 仓库公开卫生

Intero 缺 SECURITY.md、CONTRIBUTING.md、CHANGELOG.md，README 还写着
“安全策略发布前请勿公开报告”。TabTin 中英双份全齐。公开前必须补。

### 5.11 Zulip 的 topic 模型

Zulip 的每条消息必须属于一个 stream 里的 topic。topic 轻量、可标记 resolved、
可在 stream 之间移动，未读按 topic 聚合。这和 Intero 的 Coordination Thread 是同一形状：
有界、有结论、可关闭。现有域模型已有 `thread_concluded` 事件。

抄法：Room 内消息默认归属 topic，而不是 Slack 式的平铺 channel + 可选 thread。
Intero 自动开的 Coordination Thread 就是一个 topic，人手动开的讨论也是。
resolved 对应 concluded，移动对应 scope 推断改判后的迁移。
这样“重复信号更新同一路径不新建”在 UI 上有天然承载。

### 5.12 TabTin 的 App 模型

TabTin 把消息、文档、表格、幻灯片当同一个协作面，Agent 和人编辑同一份结果，
不需要从聊天下载文件再传回。

对应 Intero：Spec Review 已经有不可变 revision、评论、确认、provenance、可回退的
Agent 修改。它是一个文档原语，只是现在只服务 Spec。扩成通用协作文档，
Stand-in 和 Intero 的输出直接落在文档里而不是聊天消息里。这一条成本高，
但它决定 Intero 是“带协调的聊天”还是“协作平台”。

### 5.13 Slack 的入口体验

聊天要成为入口，最低门槛是：全文搜索、unread 优先的导航、轻量通话、文件预览、
手机端推送。LiveKit 通话已在做。搜索和手机端是缺口里最大的两项。
Slack 花了多年到这个门槛，Intero 不需要全部，但搜索和推送没有就不会有人搬进来。

## 6. 不抄的

- worktree 并行编排。50 个项目在做，Claude Code 自己已出 agent teams。
- transcript 存储和检索。Entire 做得最好，也是 Intero 明确不做的。
- 自己跑 Agent、浏览器自动化、anti-detect。执行层由 Coding Agent 厂商竞争。
- 冻结原始文件的整包 handoff。和“不收原始内容”直接冲突。

办公套件和手机端不在这个清单里。它们属于“大而全”范围内的排期问题，见 5.12 和 5.13。

## 7. 建议的下一步

位置比同类好，产品比同类窄，分发比同类差。两条线并行：协调核心保持差异化，
聊天入口达到团队愿意搬进来的门槛。

1. 协调核心：5.1 git 锚点 + 5.2 关系类型。低成本，加固核心论点。
2. 单人价值：5.3 prime + 5.4 单机模式。解决冷启动。
3. 聊天入口：5.11 topic 模型定形，5.13 搜索和推送补齐。这是“大而全”的最低门槛。
4. 5.10 仓库卫生。半天。
5. 公开。
6. 5.12 通用协作文档，在前面五步之后。

## 附录：数据来源

- [tabtin-ai/TabTin](https://github.com/tabtin-ai/TabTin)，
  [TabTin developer getting started](https://www.tabtin.com/en/developer-support/getting-started/)
- [andyrewlee/awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators)
- [entireio/cli](https://github.com/entireio/cli)
- [gastownhall/beads](https://github.com/gastownhall/beads)
- [OpenAI Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/)，
  [Help Net Security 报道](https://www.helpnetsecurity.com/2026/04/28/openai-symphony-codex-orchestration-linear/)
- [Augment: open-source agent orchestrators](https://www.augmentcode.com/tools/open-source-agent-orchestrators)
- [Nimbalyst: agent management tools 2026](https://nimbalyst.com/blog/best-agent-management-tools-2026/)
- [Vibe Kanban](https://vibekanban.com/)
