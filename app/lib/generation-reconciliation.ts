/**
 * Read-only, exact database predicates for operator triage.
 * A job's age is a signal to investigate, NEVER proof that n8n did no work.
 * Keep the queued cutoff aligned with QUEUED_RECOVERY_MIN_AGE_MS.
 */
export const GENERATION_RUNNING_STALE_MS = 30 * 60_000;

export function generationReconciliationFilters(
  now: Date,
  queuedMinAgeMs: number
) {
  if (!Number.isFinite(now.getTime()) ||
      !Number.isSafeInteger(queuedMinAgeMs) || queuedMinAgeMs < 0) {
    throw new Error("Invalid reconciliation clock or queued age");
  }
  const queuedCutoff = new Date(now.getTime() - queuedMinAgeMs);
  const runningCutoff = new Date(now.getTime() - GENERATION_RUNNING_STALE_MS);
  return {
    // Version-1 queued work is safe for the existing authenticated recovery
    // worker to claim. This report itself never sends it.
    recoverableQueued: {
      status: "queued", outboxVersion: 1, createdAt: { lte: queuedCutoff }
    },
    // Legacy or unrecognized versions have no proven no-POST invariant.
    manualQueued: { status: "queued", outboxVersion: { not: 1 } },
    // A crash between claim and POST may look identical to a running execution.
    staleRunning: { status: "running", updatedAt: { lte: runningCutoff } },
    // Even a very recent ambiguous HTTP response requires evidence.
    uncertainDelivery: { status: "dispatch_uncertain" },
  } as const;
}
