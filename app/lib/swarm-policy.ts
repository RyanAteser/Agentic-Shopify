import { AGENTS } from "./agent-registry";

/** Names in the Shopify AppSubscription are not editable browser inputs. */
export const SWARM_PLANS = {
  free: { monthlyUsd: 0, specialistSlots: 2, researchCredits: 25 },
  starter: { monthlyUsd: 29, specialistSlots: 5, researchCredits: 150 },
  growth: { monthlyUsd: 79, specialistSlots: 15, researchCredits: 600 },
  scale: { monthlyUsd: 199, specialistSlots: 50, researchCredits: 2000 },
} as const;
export type SwarmPlan = keyof typeof SWARM_PLANS;
export type SwarmRole = (typeof AGENTS)[number]["id"];
export type SwarmAgentKind = "specialist" | "skeptic";
export type SwarmMessageKind = "brief" | "hypothesis" | "evidence" | "challenge" | "revision" | "verdict";

const names: Record<Exclude<SwarmPlan, "free">, string> = {
  starter: "Agentic Swarm Starter",
  growth: "Agentic Swarm Growth",
  scale: "Agentic Swarm Scale",
};
const roles = new Set<string>(AGENTS.map(agent => agent.id));
export const MAX_SPECIALISTS = SWARM_PLANS.scale.specialistSlots;
export const SKEPTIC_GROUP_SIZE = 5;

/**
 * No paid entitlements unless a verified Shopify subscription adapter is
 * explicitly enabled. Do not allow a plan name from URL, cookie or form.
 */
export function verifiedSwarmPlan(
  subscriptions: unknown,
  enabled: boolean,
): SwarmPlan {
  if (!enabled || !Array.isArray(subscriptions)) return "free";
  const verified = subscriptions.filter(row =>
    row && typeof row === "object" &&
    typeof row.name === "string" && row.status === "ACTIVE" &&
    typeof row.id === "string" && /^gid:\/\/shopify\/AppSubscription\/[1-9][0-9]*$/.test(row.id));
  for (const id of ["scale", "growth", "starter"] as const) {
    if (verified.some(row => row.name === names[id])) return id;
  }
  return "free";
}

export function isSwarmRole(value: string): value is SwarmRole {
  return roles.has(value);
}
export function requireSwarmRole(value: string): SwarmRole {
  if (!isSwarmRole(value)) throw new SwarmPolicyError("Unknown specialist role.");
  return value;
}

export class SwarmPolicyError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "SwarmPolicyError";
  }
}

export function requireSlotCount(input: unknown): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) ||
      input < 0 || input > MAX_SPECIALISTS) {
    throw new SwarmPolicyError("Agent slots must be an integer from 0 to 50.");
  }
  return input;
}

/** Skeptics are derived per specialist ROLE, not pooled across the shop. */
export function requiredSkeptics(specialistCount: number): number {
  requireSlotCount(specialistCount);
  return Math.ceil(specialistCount / SKEPTIC_GROUP_SIZE);
}

export function calculateSwarmRoster(
  entries: readonly {role: string; kind: SwarmAgentKind; status: string}[],
) {
  const rolesCount: Record<string, {specialists: number; skeptics: number}> = {};
  let totalSpecialists = 0;
  let totalSkeptics = 0;
  for (const entry of entries) {
    if (entry.status !== "active") continue;
    if (!isSwarmRole(entry.role) ||
        (entry.kind !== "specialist" && entry.kind !== "skeptic")) {
      throw new SwarmPolicyError("Unknown active agent configuration.");
    }
    const state = rolesCount[entry.role] ??= {specialists: 0, skeptics: 0};
    if (entry.kind === "specialist") {
      state.specialists++; totalSpecialists++;
    } else {
      state.skeptics++; totalSkeptics++;
    }
  }
  for (const group of Object.values(rolesCount)) {
    if (group.skeptics !== requiredSkeptics(group.specialists)) {
      throw new SwarmPolicyError("Skeptic coverage does not match specialist allocation.", 409);
    }
  }
  return {roles: rolesCount, totalSpecialists, totalSkeptics};
}

export function mayResizeRole(params: {
  currentTotal: number; currentRole: number; requested: number; plan: SwarmPlan;
}): {nextTotal: number; skeptics: number} {
  const {currentTotal, currentRole, requested, plan} = params;
  requireSlotCount(currentTotal);
  requireSlotCount(currentRole);
  requireSlotCount(requested);
  if (currentRole > currentTotal) throw new SwarmPolicyError("Invalid team allocation.");
  const nextTotal = currentTotal - currentRole + requested;
  const cap = SWARM_PLANS[plan].specialistSlots;
  // A downgrade may leave an over-quota team; allow only reductions until
  // it fits again. Do not silently delete merchants' saved configurations.
  if (nextTotal > cap && requested >= currentRole) {
    throw new SwarmPolicyError(
      "Subscription slot limit reached. Reduce an allocation or upgrade the verified plan.", 403);
  }
  return {nextTotal, skeptics: requiredSkeptics(requested)};
}

export function validateResearchBrief(input: {
  title: unknown; hypothesis: unknown; metric: unknown; rejectionRule: unknown;
}) {
  const clean = (v: unknown, limit: number, label: string) => {
    if (typeof v !== "string" || v.length > limit ||
        v.trim().length < 8 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) {
      throw new SwarmPolicyError(label + " must contain 8-" + limit + " plain-text characters.");
    }
    return v.trim();
  };
  return {
    title: clean(input.title, 140, "Title"),
    hypothesis: clean(input.hypothesis, 1200, "Hypothesis"),
    metric: clean(input.metric, 600, "Success metric"),
    rejectionRule: clean(input.rejectionRule, 600, "Rejection rule"),
  };
}

export function assertAgentMessage(input: {
  kind: SwarmMessageKind; actorKind: SwarmAgentKind;
  content: string; evidenceUrls: readonly string[];
  falsifier?: string; verdict?: "supported"|"rejected"|"abstain";
}) {
  if (input.actorKind !== "specialist" && input.actorKind !== "skeptic") {
    throw new SwarmPolicyError("Unrecognized agent authority.", 403);
  }
  if (!["hypothesis", "evidence", "challenge", "revision", "verdict"].includes(input.kind)) {
    throw new SwarmPolicyError("Invalid worker message type.");
  }
  if (input.actorKind === "skeptic" && !["challenge", "verdict"].includes(input.kind)) {
    throw new SwarmPolicyError("Skeptics must challenge or issue a verdict.");
  }
  if (input.actorKind === "specialist" && ["challenge", "verdict"].includes(input.kind)) {
    throw new SwarmPolicyError("Specialists cannot sign skeptic challenges.");
  }
  if (typeof input.content !== "string" || input.content.trim().length < 12 ||
      input.content.length > 4000) throw new SwarmPolicyError("Worker message length invalid.");
  if (!Array.isArray(input.evidenceUrls) || input.evidenceUrls.length > 6 ||
      input.evidenceUrls.some(url => !isPublicEvidenceUrl(url))) {
    throw new SwarmPolicyError("Evidence references must be public HTTPS URLs.");
  }
  if (["hypothesis", "revision", "verdict"].includes(input.kind) &&
      (!input.falsifier || input.falsifier.trim().length < 8 ||
      input.falsifier.length > 600)) {
    throw new SwarmPolicyError("This claim requires an explicit failure condition.");
  }
  if (input.kind === "verdict" && input.evidenceUrls.length === 0 &&
      input.verdict !== "abstain") {
    throw new SwarmPolicyError("Supported verdicts require evidence.");
  }
}

export function isPublicEvidenceUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.port && !host.endsWith(".localhost") && !host.endsWith(".local") &&
      !host.endsWith(".internal") && !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1|\[)/.test(host) &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host);
  } catch { return false; }
}
