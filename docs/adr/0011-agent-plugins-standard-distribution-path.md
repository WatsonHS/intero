# ADR-0011: Agent Plugins standard as an additional launcher distribution path

Status: proposed

Date: 2026-08-08

Builds on: ADR-0006, ADR-0010

## Context

On 2026-08-06, OpenAI, AWS, Cursor, GitHub, Microsoft, and Vercel published
Agent Plugins 1.0.0, an open, vendor-neutral package format for distributing
agent extensions (https://agent-plugins.org, spec repository
`agentplugins/agent-plugins-spec`). A plugin is a directory containing a
`plugin.json` manifest, an optional `skills/` directory of Agent Skills, and
an optional `mcp.json` describing MCP servers. Launch clients include Codex,
Cursor, ChatGPT, GitHub Copilot, Kiro, and VS Code.

The 1.0.0 specification is deliberately narrow:

- it defines exactly two portable component types, skills and MCP servers;
- lifecycle hooks, commands, rules, instructions files, and LSP servers are
  explicitly excluded from v1 as "too client-specific for a stable portable
  contract";
- authentication, credential formats, permissions, installation mechanics,
  marketplaces, and project-level scoping are out of scope;
- an `extensions` namespace and vendor directories exist as an escape hatch,
  but the spec assigns them "no portable discovery, validation, loading, or
  failure semantics";
- environment expansion is limited to `PLUGIN_ROOT` and `PLUGIN_DATA` in MCP
  `args`, `env` values, and `cwd` — never in `command`, URLs, or headers.

Intero currently reaches native Coding Agent clients through two parallel
mechanisms that duplicate the same file-path knowledge:

- `packages/integrations` defines five adapters (Codex, Claude Code,
  OpenCode, Grok Build, Cursor) that write eleven managed configuration
  targets across five file formats, guarded by the marker-merge, locking,
  and two-phase-manifest machinery in `installer.ts`;
- `buildConnectPrompt()` in `apps/server-api` emits a second, prose-and-JSON
  form of the same knowledge (`intero-agent-setup/v1`) for the Web/CLI
  fallback path.

ADR-0010 already separates two layers with different trust properties: the
credential-free `intero` launcher registration, installed once per tool, and
the attachment itself — a revocable, ticket-mediated, Project-scoped binding
whose security semantics live in the cloud and in the per-repository
encrypted workspace bucket, never in client configuration files.

The Agent Plugins standard maps precisely onto the launcher-registration
layer and onto nothing else. Two of Intero's five supported clients (Codex
and Cursor) are launch clients of the standard. Claude Code uses its own
near-identical native plugin format that is not part of the standard.
OpenCode and Grok Build have announced no support.

## Decision

Intero adopts the Agent Plugins standard as an **additional distribution
vehicle for the credential-free launcher layer only**. It does not replace
the managed install path.

> **Two attach transports, one attachment contract.**

- **Standard plugin path:** for clients with native Agent Plugins support,
  Intero publishes the `intero` plugin containing `plugin.json`, an
  `mcp.json` entry that launches the existing stdio bridge, and one skill
  describing how to work with Intero. Installing the plugin is equivalent to
  launcher registration and nothing more. The plugin identity is single
  (`plugin.json` is byte-identical across clients), but the artifact is
  emitted per client because `mcp.json` must carry the explicit
  `--mcp-source` client argument the bridge requires; see Bridge resolution.
- **Managed install path:** the existing adapter and installer machinery
  remains canonical for every capability the standard cannot express and for
  every client without standard support.

The attachment contract of ADR-0010 — one-time tickets, revocable opaque
credentials, `intero.validate_connection`, per-repository encrypted
workspace buckets, cloud-side revocation, and audit — is unchanged and
identical on both paths. The plugin path changes how the bridge arrives on
the machine; it changes nothing about how a binding is authorized.

### Boundary between the two paths

The plugin package may contain only:

- the `plugin.json` manifest and standard metadata;
- one `mcp.json` entry for the `intero` stdio bridge;
- skills whose content is derived from the same instruction source used by
  the managed adapters (`INSTRUCTION_CONTENT`), so the knowledge has one
  origin.

The plugin package must never contain:

- credentials, tickets, tokens, or any authorization material;
- Project, member, binding, or workspace identifiers;
- per-repository or per-user state of any kind;
- client-specific `extensions` payloads (including hook configurations) in
  its initial version, because the spec gives them no loading guarantees and
  a silently unloaded hook would create a false capability claim.

Capabilities the standard cannot express stay on the managed install path
even for standard-capable clients:

- session lifecycle hooks (`lifecycleHooks` adapters: Codex, Claude Code,
  OpenCode);
- always-on instructions and rules files, which are not equivalent to
  on-demand skills;
- the OpenCode managed plugin file.

A standard-capable client that also needs hooks therefore runs in a hybrid
mode: the plugin registers the bridge, and the managed installer writes only
the hook entries. `managedIntegrationTargets` must report this split
truthfully so preview, repair, and detach show the real set of Intero-owned
files.

### Lifecycle mapping

Installing the plugin does not create an attachment. The ADR-0010 lifecycle
states apply unchanged; the plugin path only affects how the first two are
reached:

- plugin installation is local launcher registration at most: Desktop may
  truthfully report that the bridge is registered and that the registration
  arrived via the plugin, but plugin presence alone derives no attachment
  state beyond "configuration written";
- a binding becomes connected only after ticket exchange, MCP `initialize`,
  and `intero.validate_connection` succeed, exactly as on the managed path;
- the UI must not claim Connected because a plugin is installed, for the
  same reason it must not claim Connected because a file was written.

Repair on the plugin path means asking the client to reinstall or re-enable
the plugin, or falling back to a managed install; Intero does not edit files
inside a client-owned plugin installation. Detach revokes the cloud binding
first, as always; removing the plugin is a client-owned operation that
Intero may request but does not perform, and cloud revocation remains
successful and visible regardless.

### Bridge resolution

`mcp.json` cannot expand variables in the `command` field, so the plugin
either references the separately installed `intero` launcher executable on
`PATH`, or launches a bundled bridge as `command: "node"` with a
`${PLUGIN_ROOT}` script argument. The initial slice uses the installed
launcher and must fail with one clear, actionable message when the launcher
is missing, rather than a generic MCP spawn error. Bundling is a later
packaging decision, not a contract change.

Client identity stays explicit. The bridge resolves per-repository encrypted
state per client (ADR-0010), so `mcp.json` declares `--mcp-source` and the
artifact varies per client in that argument alone. To contain the resulting
misinstall hazard (a Codex-flavored artifact installed into Cursor would
masquerade as Codex), the bridge must cross-check the declared source
against the `clientInfo` it receives in MCP `initialize`: a recognized,
contradicting client fails closed with one actionable message naming the
correct artifact; an unrecognized `clientInfo` does not block. The
cross-check is a guard, not inference — it never selects an identity on the
client's behalf.

### Connect prompt convergence

For standard-capable clients, `buildConnectPrompt()` gains a plugin-path
variant that instructs the agent or user to install the published plugin
instead of restating per-client file paths. This is the first step toward
collapsing the duplicated adapter knowledge; the managed variant remains for
all other clients.

## Security and privacy invariants

- The published plugin is public, static, and credential-free; possession of
  the plugin grants no access to any Intero deployment, Project, or member.
- The bridge resolves encrypted connection state from the current repository
  plus client exactly as today, regardless of which path registered it.
- The plugin path cannot bypass ticket issuance, identity binding, native
  validation, or revocation; there is no plugin-only authorization shortcut.
- Cloud revocation is enforced on every Project operation and never depends
  on plugin presence, absence, or version.
- Intero does not write into, delete, or take ownership of client-managed
  plugin directories; managed-file invariants from ADR-0010 apply only to
  managed-path targets.

## Implementation boundary

- A build step in `packages/integrations` (or a sibling package) generates
  the plugin artifact from the existing adapter constants and
  `INSTRUCTION_CONTENT`, so the plugin and the managed adapters cannot
  drift apart silently.
- `packages/integrations` gains a per-client capability flag for standard
  plugin support next to `MINIMUM_SUPPORTED_VERSIONS`, with the minimum
  client version that ships working Agent Plugins support.
- Desktop detection (`agentConfigurationState`) learns to recognize a
  bridge registered via plugin as satisfying launcher registration, using
  the same per-client verification commands.
- `installer.ts` and its safety invariants are not modified by this
  decision; the hybrid mode only narrows which targets an install plan
  contains.
- No server-side authorization surface changes. `pilot-routes.ts` changes
  are limited to the connect-prompt variant.

## Acceptance evidence

Before the plugin path is documented as supported for a client, prove:

1. the published plugin validates against the 1.0.0 schema and loads in
   that client with no skill or MCP entry rejected;
2. installing the plugin on a clean machine registers the bridge and
   nothing else — no credentials, no workspace state, no hook entries;
3. the full ADR-0010 attach lifecycle (ticket, exchange, validation,
   connected state) completes over a plugin-registered bridge;
4. a missing launcher is named as a prerequisite with actionable guidance
   in the plugin-path connect prompt (a static artifact cannot intercept
   the client's own spawn error; bridge-side interception is follow-up
   work, not initial-slice acceptance);
5. hybrid mode on a hooks-capable client shows the true split of
   plugin-owned versus managed targets in preview, repair, and detach;
6. detach revokes cloud access while the plugin remains installed, and the
   revoked bridge cannot perform any Project operation;
7. uninstalling the plugin leaves managed-path installations of other
   clients and all workspace buckets untouched;
8. the generated plugin content is byte-reproducible from the adapter
   sources in CI.

## Consequences

### Positive

- Standard-capable clients gain a familiar, client-owned install path, and
  future standard adopters are reachable without a new Intero adapter.
- The launcher layer becomes a public, inspectable artifact instead of
  eleven per-client file mutations, for the clients that support it.
- The duplicated knowledge in `buildConnectPrompt()` begins to collapse
  toward "install the plugin".
- The attachment contract stays single-sourced; no security semantics fork
  across paths.

### Costs and risks

- Two transports for the launcher layer must be detected, explained, and
  repaired distinctly; hybrid mode adds lifecycle edges.
- The specification is days old; client loading behavior, update semantics,
  and store policies are unproven and may churn. Pinning to the 1.0.0
  schema identifier limits but does not remove this risk.
- Hooks remain outside the standard, so the managed installer cannot be
  retired for any hooks-dependent client; the plugin path removes at most
  the MCP-registration portion of two of five current adapters today.
- A client that partially loads the plugin (skill but not MCP, or the
  reverse) creates states the UI must report honestly.

## Rejected alternatives

### Migrate the managed installer wholesale to the standard

Rejected. The standard has no portable representation for lifecycle hooks,
rules files, credentials, per-project scoping, or fail-closed uninstall,
which is where the ADR-0010 invariants live. A wholesale migration would
silently drop the guarantees the installer exists to provide.

### Ship hooks through the `extensions` vendor mechanism

Rejected for the initial version. The spec assigns vendor extensions no
loading or failure semantics, so a client may ignore them without error.
Hooks that appear installed but never fire would corrupt the Work State
capability claims that depend on them. Revisit if the standard adds hooks
as a portable component type.

### Embed the per-Project streamable-HTTP MCP endpoint in the plugin

Rejected. The endpoint URL encodes Project and binding identity and
requires credentials the standard cannot carry. It would either leak
identifiers in a public artifact or require URL mutation the spec forbids.

### Infer the calling client inside the bridge

Deferred, not adopted. Inferring identity from MCP `initialize`
`clientInfo` would restore a literally-single artifact, but `clientInfo`
name strings are client-defined and version-unstable, so inference creates
a new drift-maintenance surface for a benefit that is aesthetic while the
standard has no marketplace and only two supported clients are reachable
through Intero-controlled distribution. Explicit `--mcp-source` plus the
initialize-time cross-check keeps identity declared and fail-closed.
Re-evaluate when the standard gains a marketplace or registry, when
standard-capable client coverage grows enough that the per-client artifact
matrix becomes a real cost, or when validated misinstall reports show the
cross-check is insufficient.

### Wait for the specification to mature before doing anything

Rejected as a sole strategy. The launcher layer is exactly the
credential-free surface where early adoption is cheap and reversible, and
launch-client coverage already includes two supported clients. Waiting is
retained for everything the spec excludes: hooks, rules, and credential
material adopt nothing until the standard can express them.

## Transition

The managed install path and connect prompt remain the documented default
for all clients until the acceptance evidence passes per client. The plugin
artifact ships as opt-in, and documentation must state per client which
path is recommended and which capabilities require hybrid mode. Three work
items follow this ADR: the initialize-time declaration cross-check, bridge
single-message handling for a missing launcher, and an explicit Desktop
"plugin owns the bridge" opt-in control — without it, hybrid mode is
reachable only by detecting a pre-existing plugin registration, and the
default install remains full managed. If a future
specification version adds portable hooks, a follow-up ADR should revisit
how much of the managed adapter layer can retire; this ADR deliberately
retires none of it.
