# Pilot browser evidence

Current canonical-renderer evidence:

- `01-scenario-1-member-a-dm.png`
- `02-scenario-1-member-b-dm.png`
- `05-readable-team-pulse.png`
- `06-readable-representative-answer.png`
- `07-two-client-dm.png`
- `08-coordination-master-detail.png`
- `09-withdrawal-propagated.png`
- `10-member-a-dm-after-reply.png`

The final run used Chrome as member A (`Intero User`) and the in-app browser as
member B (`Morgan Chen`), two independent browser storage contexts against the
same `http://127.0.0.1:4310` deployment. A reusable Team join link enrolled B,
and `07` plus `10` show the same persistent two-way direct-message exchange in
the canonical Communications view.

Scenario 2 was captured on 2026-07-26 from member B after the active Codex
connection submitted `billing-export-review-20260726-0110` through direct cloud
MCP. The API persisted private Work State
`019f9a41-f6eb-726f-af3a-0e484df65f78`; the real administrator-configured
provider at
`https://provider.example/v1` using model `example-model` generated and
published the safe summary and bounded coordination suggestion. Screenshot `05`
shows the five-part human-readable Team Pulse narrative plus MCP provenance and
freshness. Screenshot `06` shows Morgan's grounded question, the real-provider
answer (current status, outcome, evidence, next step, and collaboration need),
and the cited Work State/source/freshness card. Screenshot `08` shows the
project-internal Coordination master-detail projection.

Member A then withdrew only the published billing-export summary. Screenshot
`09` shows that member B no longer sees it after the polling interval, while the
originator's private Work State still contains the complete structured
narrative. The MCP retry used the same client event ID, returned
`duplicate: true`, did not republish the withdrawn entry, and left the encrypted
outbox at zero pending events.

This run used the in-memory pilot store. No provider credential appears in
browser responses, CLI output, screenshots, or this evidence record. State will
reset when the API restarts.

`03-scenario-2-team-pulse-grounding.png` and
`04-scenario-2-representative-answer.png` are retained as the before-correction
record of generic validation prose and metadata-first answers. The older files
named `01-member-a-dm.png` through `07-member-b-after-withdrawal.png` are
historical debugging artifacts and do **not** satisfy current pilot acceptance.
