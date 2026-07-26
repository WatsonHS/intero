# Account and Settings UI refinement validation

This refinement keeps the canonical desktop renderer and does not change the
Spec Review surface.

## Automated browser smoke

Start the guarded demo runtime against a disposable database, then run:

```bash
INTERO_E2E_RENDERER_URL=http://127.0.0.1:5193 \
  pnpm exec playwright test tests/e2e/settings-account.spec.ts --headed
```

The smoke verifies:

- password sign-in appears before Passkey, including password visibility and
  keyboard focus;
- the bottom-left account control opens, edits the persisted display name and
  avatar tone, deep-links to Personal Settings, and signs out;
- Settings exposes the six canonical categories;
- Team & Members uses the Intero token-based role menu rather than native
  browser selects, with keyboard open and Escape focus restoration.

The test restores the demo account name and avatar before signing out. Resetting
or reseeding remains guarded by `INTERO_DEMO_CONFIRM` and is allowed only for an
explicitly named disposable demo/test database.
