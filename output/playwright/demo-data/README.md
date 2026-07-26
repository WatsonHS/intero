# Demo data browser smoke

Validation date: 2026-07-26 (Asia/Shanghai)

## Boundary

- Canonical product UI: `apps/desktop` browser renderer, unchanged by the Demo
  implementation.
- Browser URL: `http://127.0.0.1:5183`.
- API URL: `http://127.0.0.1:4323`.
- Database: new disposable loopback database `intero_demo_validation`.
- Authentication: two independent Better Auth development magic-link sessions;
  the global development identity header was disabled.
- Model: no external provider call. Published Work State/Pulse was produced by
  the one-shot `intero-demo-deterministic` seeder through the real Pilot Store.
- Persistence: PostgreSQL normalized Pilot and Phase 5 tables. No frontend
  hardcoded fixture or request interception was used.

## Reproduction

1. Follow `docs/DEMO_DATA.md` to create and seed a dedicated local database.
2. Start the API and canonical renderer with `pnpm dev:demo`.
3. Sign in as `alex@demo.intero.test` through the normal login page. Retrieve
   the local development link from:

   ```text
   GET /api/auth/dev/magic-link?email=alex@demo.intero.test
   ```

4. Verify Team Pulse, the Sprint board, carryover, Work Item detail, threaded
   comments, explicit code references, Spec Review filters and immutable
   versions, persistent DM, and Coordination master-detail.
5. Move `Publish cross-team authorization tuple` from `todo` to `in_progress`,
   add a Work Item comment, add a current-version Spec comment, and send a DM.
6. Open a second isolated browser session and sign in as
   `morgan@demo.intero.test`. Verify that the moved Work Item and new persistent
   DM are visible without an admin identity.

## Evidence

- `01-team-pulse.png`: multiple people, peer work cards, blockers, evidence,
  safe Stand-in narratives, and project sharing posture.
- `02-project-board.png`: current Sprint board with every status and an
  ended-Sprint carryover marker.
- `03-work-item-comment.png`: canonical Work Item detail with persisted nested
  comments, facts, Spec link, relations, and explicit branch reference.
- `04-board-move.png`: persisted status move through the canonical board
  control.
- `05-spec-review.png`: review filter, current rev 2, previously confirmed rev
  1, nominated reviewer, and version-bound unresolved comment.
- `06-persistent-dm.png`: admin-side participant-only persistent 1:1 DM after a
  real send.
- `07-coordination.png`: seeded bounded Coordination master-detail and safe
  candidate next steps.
- `08-member-team-pulse.png`: independent member session observing the shared
  seeded Project and the admin's board move.
- `09-member-persistent-dm.png`: independent member session observing the
  persisted DM.

Both browser sessions reported zero console errors during the smoke.
