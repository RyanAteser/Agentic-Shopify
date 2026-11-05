/**
 * Operator-only, READ-ONLY job reconciliation report.
 *
 * npx tsx scripts/generation-reconciliation-report.ts
 * npx tsx scripts/generation-reconciliation-report.ts --details
 *
 * Does not contact Shopify/n8n, dispatch jobs, retry, publish or refund.
 * Default output contains exact aggregate counts only. --details includes
 * at most ten job IDs per category for authorized n8n execution lookup;
 * it never prints shop domains, topics, article text, errors or credentials.
 */
import db from "../app/db.server";
import { generationReconciliationFilters } from "../app/lib/generation-reconciliation";
import { QUEUED_RECOVERY_MIN_AGE_MS } from "../app/lib/queued-recovery.server";

const categories = [
  "recoverableQueued", "manualQueued", "staleRunning", "uncertainDelivery"
] as const;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npx tsx scripts/generation-reconciliation-report.ts [--details]");
    return;
  }
  if (args.some(arg => arg !== "--details")) {
    throw new Error("Only --details is supported");
  }
  const now = new Date();
  const filters = generationReconciliationFilters(now, QUEUED_RECOVERY_MIN_AGE_MS);
  const pairs = await Promise.all(categories.map(async category =>
    [category, await db.contentJob.count({ where: filters[category] })] as const
  ));
  const counts = Object.fromEntries(pairs);
  const report: Record<string, unknown> = {
    asOf: now.toISOString(),
    readOnly: true,
    counts,
    interpretation: "Age/status alone cannot establish whether n8n began paid work. Never automatically retry or refund running/uncertain/legacy jobs.",
  };

  if (args.includes("--details")) {
    const samples = await Promise.all(categories.map(async category => {
      const jobs = await db.contentJob.findMany({
        where: filters[category],
        select: { id: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: "asc" },
        take: 10
      });
      return [category, {
        sampleLimited: counts[category] > jobs.length,
        jobs: jobs.map(job => ({
          jobId: job.id,
          ageMinutes: Math.max(0, Math.floor(
            (now.getTime() - (category === "staleRunning" ||
              category === "uncertainDelivery" ? job.updatedAt : job.createdAt).getTime()) / 60_000
          ))
        }))
      }] as const;
    }));
    report.details = Object.fromEntries(samples);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  // Never log raw Prisma errors, SQL, merchant identifiers or connection URLs.
  console.error("Reconciliation report unavailable:", error instanceof Error ? error.name : "unknown");
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
