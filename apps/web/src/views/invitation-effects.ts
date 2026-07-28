interface InvitationCreatedEffects {
  copyLink: () => Promise<void>;
  refresh: () => Promise<void> | void;
  onCopySuccess?: () => void;
  onCopyFailure?: () => void;
}

/**
 * An invitation is complete when the API creates it. Clipboard access and
 * cache refreshes are best-effort follow-up work and must never keep the
 * mutation pending or turn a successful invitation into an error.
 */
export function runInvitationCreatedEffects({
  copyLink,
  refresh,
  onCopySuccess,
  onCopyFailure,
}: InvitationCreatedEffects): void {
  void Promise.resolve()
    .then(copyLink)
    .then(onCopySuccess, onCopyFailure)
    .catch(noop);
  void Promise.resolve().then(refresh).catch(noop);
}

function noop(): void {}
