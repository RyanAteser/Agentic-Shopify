/** Per-action ceiling; AI recommendations cannot grant additional permissions. */
export type PermissionLevel = "observe" | "draft" | "approval_required" | "blocked";
export const ACTION_POLICY = {
  "seo.rank.read": "observe",
  "seo.audit.read": "observe",
  "content.article.draft": "draft",
  "content.article.publish": "approval_required",
  "product.description.draft": "draft",
  "product.update": "approval_required",
  "inventory.reorder.propose": "draft",
  "inventory.quantity.write": "approval_required",
  "marketing.email.draft": "draft",
  "marketing.email.send": "approval_required",
  "support.response.draft": "draft",
  "support.refund": "approval_required",
  "ads.budget.change": "approval_required",
  "orders.fulfill": "approval_required",
  "pricing.change": "approval_required",
  "theme.code.deploy": "blocked",
  "security.permissions.change": "blocked",
} as const satisfies Record<string,PermissionLevel>;
export type AgentAction = keyof typeof ACTION_POLICY;

export function canExecuteAction(action: string, {
  humanApproved = false, automationEnabled = false
}: {humanApproved?:boolean; automationEnabled?:boolean} = {}) {
  if (!Object.prototype.hasOwnProperty.call(ACTION_POLICY, action)) return false;
  const level = ACTION_POLICY[action as AgentAction];
  if (level === "blocked") return false;
  if (level === "approval_required") return humanApproved;
  if (level === "draft") return automationEnabled || humanApproved;
  return true;
}
