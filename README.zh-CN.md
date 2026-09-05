# Intero

[English](README.md) · 简体中文

## 愿景

Intero 是一项持续进行的实践探索：在 AI 原生时代，协作软件与软件工程应该变成什么样子？

### 名字的含义

`Intero` 来自 _interoception_，意为一个生命体对自身内部状态的感知。这个名字对应着项目最初的想法：让团队知道自己内部正在发生什么。当人与 Agent 越来越独立地工作时，Intero 希望探索团队如何持续感知自身的工作、变化、冲突、决策和产品能力。

### 发生了什么变化

许多传统软件工程实践形成于个体能力更有限、专业分工相对稳定的时期。前端、后端、产品、设计、运维和架构工作通常由不同的人承担，许多协作方式也围绕这些工作交接逐渐形成。

AI 改变了这个前提。一个人与 Coding Agent 协作时，可以在一次工作会话中跨越多个边界。每个人都能更加独立地探索和实现；过去需要多位专业人员配合的工作，现在可能由一个人和他的 Agents 完成。这扩大了个人能够尝试的工作范围，但并没有消除专业经验、责任边界，也不意味着探索、稳定化和维护阶段应该采用同一种工作方式。

### 我们实际遇到的问题

1. **自主性越高，自然发生的信息同步反而越少。** 开发前端功能的人可能发现一个后端缺陷，并直接修复，而不是将它交给另一位专业人员。后端维护者可能根本不知道行为已经改变；修复可能违反了作者并不知道的假设；另一个 Agent 也可能继续基于原有契约工作。
2. **交付增长速度超过了团队对产品现实的理解速度。** 一些重要能力源于想法或实验，而不是正式的 Feature、Spec 或工单。传统跟踪工具可以记录已声明的工作，却未必能够描述产品实际上已经变成什么、有哪些证据支持某项能力，或者后续修改是否让它面临风险。每一个局部任务看起来都已完成，过去正常工作的行为却可能已经悄然回归。
3. **AI 产出速度超过了人的评审和决策能力。** AI 可以在人还没有充分理解陌生领域之前，就生成计划、Spec、备选方案和完整实现。此时，人可能无法识别错误假设、不必要的抽象、迂回设计或更简单的方案。AI 还会在一天内产生远多于以往的决策；在持续的决策疲劳中，人最难发现的恰恰是那些最需要判断的问题。
4. **自动化可能把更多协作琐事留给人。** Coding Agent 可以承担最有成就感的实现工作，人却仍然需要汇报状态、寻找相关人员、在工具之间搬运上下文、组织讨论、追踪悬而未决的问题和维护项目记录。AI 应该减少这些机械的协调工作，而不是把它们变成人类在工作流中剩下的主要部分。
5. **AI 生成的协作信息本身也可能难以理解。** 如果摘要充满内部术语、没有解释的黑话和不必要的细节，系统只是把寻找信息的成本变成了解码信息的成本。人应该先看到简短、讲人话的说明，并能在需要核查时展开准确的技术细节和证据。

这些问题具有同一个模式：执行速度已经超过了团队维持共享理解、可靠验证和集中使用人的注意力的能力。产品不仅要减少通知数量，还要降低寻找、理解、路由和处理协作上下文的成本。

我们不认为答案是恢复僵化的职责边界、要求人类批准每一项修改，或者在团队之上放置另一个不受约束的自主 Agent。我们希望探索一些更困难的问题：

- 如何让个人能力保持流动，同时继续明确共享契约和系统不变量的责任？
- 团队如何区分安全的跨边界修复，以及确实需要协调、评审或重新验证的修改？
- 协作系统如何在不收集原始私人活动、不形成监控系统的前提下，在回归发生前发现彼此不兼容的工作？
- 如何让正确的人进入一个临时且边界明确的讨论，同时只向其他人提供安静而有用的摘要？
- 如何让经过授权的团队对话成为有用的项目上下文，同时不把尚未结束的讨论当成已经确认的事实？
- AI 如何用普通语言讲清楚协作问题，同时保留技术评审需要的准确标识、不确定性和证据？
- 如何把人的注意力留给真正需要判断的决策，而不是让每一个 Agent 动作都变成新的审批？
- 当许多人和 Agent 并行修改产品时，团队如何知道产品仍然一致且可用？
- 即使事前不存在 Feature、Spec 或工单，非正式探索中发现的能力如何持续可见并可被验证？

我们当前的工作假设是：执行可以高度分散，但协调、验证和责任必须保持连续。经过授权的团队对话承载人的意图、问题、分歧和候选决定；Agent Work State 承载执行意图、变化、依赖和验证声明；仓库、测试、CI 和运行时证据说明当前实际得到什么支持。Intero 应该帮助团队持续对齐这些来源，保留它们的来源和不确定性，并将人类确认的结果带回工作上下文。

Intero 更大的意义不在于某种技术栈、模型或 AI 功能列表，而在于让这些问题变得足够具体，从而能够围绕它们进行构建、测试、证伪和修正。当前产品只是这些问题的一种实验性答案，并不意味着 Intero 应该拥有每一个任务、测试、Spec、决策或 Agent 工作流。我们会用一个标准评价这项探索：团队能否在保持自主和高速的同时，不失去共同且可信的现实。

## 产品方向

Intero 希望探索一个 AI 原生的软件工程与项目管理承载平台：项目现实从实际发生的对话、工作、决定和证据中逐渐形成，而不是依赖人把所有事情重新录入跟踪工具。

自动协调人和 Coding Agent 之间的工作，是 Intero 的基础能力。团队应该能够继续正常工作；工作彼此兼容时 Intero 保持安静，在有明确证据时，Intero 会在冲突演变成回归之前发现它。相关上下文由 AI 用普通语言准备好，只有真正需要判断或承诺时才让人介入。

推荐流程是：

```text
团队正常讨论，人或 Agent 开展实际工作
→ 经过授权的对话与结构化 Work State 成为共享信号
→ Intero 将它们与当前技术事实和验证证据关联
→ 兼容的工作保持安静
→ 有证据表明确实需要协调时，打开边界明确的协调路径
→ 人确认会产生实际后果的决定
→ 结论回到工作上下文，并逐渐沉淀为项目现实
```

因此，聊天不是项目管理的附加功能。意图、问题、分歧和决定往往首先出现在对话里。对话是重要信号，但它本身不是权威事实：Intero 可以从中形成候选问题、行动和决定；会产生实际后果的结论仍然需要证据或人的确认。

### Agent 角色

面向用户的模型只有两种 Intero Agent 角色：

- **个人替身代表“我”。** 它帮助一个人理解和准备自己的工作，保护私人上下文，只共享本人或策略明确授权的内容。
- **共享 Room 中的 Intero 代表“我们”。** 它理解经过授权的团队对话，将对话与可共享的工作和证据关联，路由项目上下文，在确实需要时推动协调，并维护经过人类确认的共享状态。

Codex、Claude Code 和 OpenCode 等外部 Coding Agent 继续负责执行，不构成第三种 Intero 角色。Project 是 Intero 内部使用的状态、授权和证据作用域，不是用户需要记住并分别 `@` 的机器人。在包含多个项目的 Team Room 中，用户只需要提及 `@Intero`；Intero 自行判断讨论属于一个项目、多个项目、Team 层面，还是确实需要一次轻量澄清。

## 当前产品

Intero 是面向使用 Coding Agent 的软件团队的协调层。它把经过授权的团队对话和结构化 Agent 检查点关联到持久、注重隐私的团队上下文：当前工作、阻塞、决策、评审状态，以及下一项协调动作。

Intero 不是会话记录收集器，也不是通用自主 Agent。它旨在保留人的权力、来源信息和项目边界，同时让团队其他成员能够理解 Agent 辅助的工作。

> **项目状态：** Intero 正处于活跃的 1.0 前开发阶段。当前仓库支持试点部署，但 API、数据库迁移和运维流程仍可能发生变化。

## Intero 提供什么

- **经过授权的实时对话：** 覆盖团队聊天、项目 Room、边界明确的协调、私聊和个人替身交互。对话可以产生可评审的候选问题、决定、关系和行动，但尚未结束的讨论不会自动成为权威事实。
- **结构化 Agent 汇报：** 通过经过认证的 MCP 端点支持 Codex、Claude Code、OpenCode 及兼容客户端。
- **私有 Work State：** 在不摄取原始提示词、Diff、文件或终端日志的前提下，记录进度、证据、阻塞、决策和验证。
- **Team Pulse：** 简洁呈现团队成员正在做什么，以及哪里需要协调。
- **讲人话的协调信息：** 先说明发生了什么、为什么重要以及是否需要人处理，同时允许按需展开准确技术细节、来源和不确定性。
- **Action Inbox：** 承载评审请求、阻塞、承诺以及其他由人负责的决策。
- **项目工作与 Spec Review：** 支持不可变修订、评论、确认、来源信息，以及可撤销的 Agent 修改。
- **有边界的替身自动化：** 可以总结经过授权的工作或提出可撤销的协调步骤，但不能修改成员关系、所有权或访问权限，也不能代替人作出最终承诺。
- **仅限邀请的访问：** 提供组织与团队管理、密码认证、Passkey，以及可撤销的 Agent 绑定。

## 设计原则

1. **默认私有。** 上传或处理信息并不意味着团队可以看到它。
2. **使用结构化信号，而不是监控。** Intero 接收语义检查点，而不是持续采集开发者活动。
3. **来源信息是数据模型的一部分。** 共享状态保留行为主体、来源、时间戳、置信度和修订历史。
4. **人的权力必须明确。** Agent 不能静默扩大范围、改变访问权限或作出不可逆决策。
5. **每个适配器边界都必须执行授权。** 组织、团队、项目和用户私有范围不能从 UI 状态中推断。
6. **对话是信号，不会自动成为事实。** AI 可以在经过授权的聊天中识别候选 Bug、依赖、决定或行动，但必须区分讨论、解释、证据和人的确认。
7. **先讲人话，再按需展示技术证据。** 面向人的内容应该让人几秒内理解事件、影响、相关性和所需行动，同时允许核对准确标识和来源而不损失精度。

完整的信任模型与技术边界记录在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 中。

## 架构

```mermaid
flowchart LR
    subgraph Clients["客户端"]
        Agents["Coding Agent"]
        Web["Web 应用"]
        Desktop["可选桌面应用"]
    end

    subgraph Intero["Intero 服务"]
        MCP["经过认证的 MCP"]
        API["产品 API"]
        Policy["授权与隐私策略"]
        Worker["持久任务与替身"]
        DB[("PostgreSQL")]
    end

    Agents --> MCP
    Web --> API
    Desktop --> API
    MCP --> Policy
    API --> Policy
    Policy --> DB
    Policy --> Worker
    Worker --> DB

    Policy --> SpiceDB["SpiceDB"]
    API --> Realtime["Centrifugo"]
    API --> Objects["S3 / MinIO"]
    Worker --> Models["已配置的模型提供方"]
```

PostgreSQL 是权威数据存储。SpiceDB 执行基于关系的授权，Centrifugo 提供实时交付，Graphile Worker 与事务性 Outbox 负责持久后台工作。对象存储兼容 S3；除非明确配置，否则产品层默认禁用。

## 仓库结构

| 路径                          | 用途                                    |
| ----------------------------- | --------------------------------------- |
| `apps/web`                    | 主要 React Web 客户端                   |
| `apps/desktop`                | 可选 Electron 桌面客户端                |
| `apps/server-api`             | HTTP、认证、MCP 与产品 API              |
| `apps/server-worker`          | 持久任务、Outbox 处理和替身工作         |
| `apps/mcp-stdio`              | 面向兼容 Coding Agent 的本地 stdio 桥接 |
| `packages/domain`             | 核心身份、事件、策略与领域契约          |
| `packages/stand-in-core`      | 替身推理与策略逻辑                      |
| `packages/project-management` | 项目工作与 Spec Review 领域逻辑         |
| `packages/api-contracts`      | 生成的 API 契约及其源定义               |
| `packages/config`             | 运行时配置与验证                        |
| `packages/integrations`       | Coding Agent 集成适配器                 |
| `infra`                       | 本地基础设施配置                        |
| `docs`                        | 架构记录、运维文档、计划与验证证据      |

该仓库是一个由 Turborepo 编排的 pnpm Workspace。

## 前置条件

- Node.js 24 或更高版本
- 通过 Corepack 使用 pnpm 10.33.2
- 带有 Docker Compose 的 Docker
- [just](https://github.com/casey/just)
- 用于可选本地密钥扫描的 [Gitleaks](https://github.com/gitleaks/gitleaks)

## 快速开始

安装依赖并启动本地开发环境：

```bash
corepack enable
just setup
just up
```

`just up` 会启动 PostgreSQL、SpiceDB、Centrifugo 和 MinIO，应用所需的数据库迁移，并启动 Web、API 和 Worker 开发进程。

默认本地端点如下：

| 服务           | URL                     |
| -------------- | ----------------------- |
| Web 应用       | `http://localhost:5173` |
| API            | `http://localhost:4310` |
| Centrifugo API | `http://localhost:8000` |
| MinIO API      | `http://localhost:9000` |

使用以下命令停止基础设施服务：

```bash
just down
```

仓库中包含的凭据和 Token 仅为开发环境默认值，绝不能在共享或生产部署中复用。

## 配置

Intero 从环境变量读取运行时配置。支持的开发设置和安全占位值记录在 [.env.example](.env.example) 中。

自定义本地环境：

```bash
cp .env.example .env
```

重要配置分组包括：

- 规范部署 URL 与可信 Origin；
- PostgreSQL 应用、迁移和 Worker 连接；
- 模型提供方密钥加密与认证密钥；
- SpiceDB、Centrifugo 与可选对象存储；
- 通过管理员 UI 配置的模型提供方端点、API Key 和默认模型。

服务端密钥绝不会通过面向普通成员的 API 返回。生产部署必须使用唯一的随机凭据、HTTPS、持久卷、备份以及针对具体环境的密钥管理。运维基线请参阅 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 开发

常用命令：

```bash
just dev-deps       # 仅启动基础设施
just dev            # 启动 Web、API 和 Worker 进程
pnpm dev:desktop    # 启动可选桌面客户端
pnpm generate       # 重新生成 API 契约
pnpm lint           # TypeScript 验证
pnpm test           # 单元测试及可运行的集成测试套件
pnpm build          # 生产构建
just check          # 生成、Lint、测试并构建
```

部分集成测试需要先通过 `just dev-deps` 启动 Docker 服务。如果外部依赖不可用，受环境控制的测试会跳过。

日常 CI 只运行接口契约一致性、类型检查、不依赖外部服务的测试和构建。修改数据库、授权、实时链路或准备发布时，手动运行 **Integration validation** 工作流，验证真实依赖和 Golden Case、Agent 连接、聊天浏览器用例。

Demo Fixture 必须显式启用，且绝不能对生产数据库运行。安全检查与命令请参阅 [docs/DEMO_DATA.md](docs/DEMO_DATA.md)。

## 安全与隐私

Intero 会处理私有工程上下文，应当被视为安全敏感服务。

- 不要提交 `.env` 文件、数据库快照、凭据或原始浏览器测试输出。
- 不要将开发部署暴露给不可信网络。
- 将模型提供方密钥保留在服务端；如果怀疑发生泄露，应立即轮换。
- 在发布 Git 历史前运行仓库密钥扫描：

  ```bash
  gitleaks git --config .gitleaks.toml
  ```

- 在修改认证、授权、发布行为或 Agent 能力之前，先阅读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 中的数据与信任边界。

在建立专用安全策略和私有报告渠道之前，请不要在公开 Issue 中报告疑似安全漏洞。

## 文档

- [Agent 开工简报与交付证据](docs/AGENT_CONTEXT.md)：按工作区接续工作，并关联提交、PR 和 CI 报告。
- [产品路线图](docs/PRODUCT_ROADMAP.zh-CN.md)
- [Golden Case：从 Team 群聊到跨项目协调](docs/GOLDEN_CASE.zh-CN.md)
- [技术架构](docs/ARCHITECTURE.md)
- [运维](docs/OPERATIONS.md)
- [试点运行手册](docs/PILOT_RUNBOOK.md)
- [Demo 数据安全](docs/DEMO_DATA.md)
- [架构决策记录](docs/adr/README.md)
- [产品需求](docs/brainstorms/2026-07-24-intero-product-requirements.md)
- [由对话驱动的协作探索](docs/plans/2026-07-29-002-conversation-driven-collaboration-todo.md)
- [R1/R2 协调内核实现计划](docs/plans/2026-07-31-001-r1-r2-coordination-kernel-implementation-plan.md)
- [Product Capability Health 下一阶段研究](docs/plans/2026-07-29-003-product-capability-health-roadmap.md)

## 贡献

Intero 仍在稳定核心契约。请保持修改范围明确，为行为变化提供测试，保留隐私和授权边界，并在提交 Pull Request 前运行 `just check`。

随着公开开发流程最终确定，我们会补充专门的贡献指南。

## 许可证

Intero 使用 [Apache License 2.0](LICENSE)。
