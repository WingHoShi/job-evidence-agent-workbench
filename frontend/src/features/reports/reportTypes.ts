export type Report = {
  task_id: number;
  generated_at: string;
  confirmed_claims: [string, string][];
  insufficient_claims: string[];
  next_steps: string[];
  conflicts: string[];
  jd_coverage: string;
  jd_requirements: { text: string; locator: string; keywords: string[]; claim_ids: number[]; status: string }[];
  claim_reviews: {
    claim_id: number; text: string; resume_locator: string;
    review_status: string; verdict: string; risk: string;
    rationale: string; gate_reason: string; warning: string; suggestions: string[];
    evidence: { chunk_id: number; source_kind: string; source_label: string; relative_path: string; locator: string; excerpt: string }[];
  }[];
};

export type ReportViewState = { id: number; report: Report | null; busy: "report" | "sync" | null; needsSync: boolean; message: string | null };
export const emptyReportState: ReportViewState = { id: 0, report: null, busy: null, needsSync: false, message: null };

function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function id(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function textFields(value: Record<string, unknown>, keys: string[]) { return keys.every((key) => typeof value[key] === "string"); }

export function isReport(value: unknown, taskId: number): value is Report {
  if (!record(value) || value.task_id !== taskId || !id(value.task_id) || !textFields(value, ["generated_at", "jd_coverage"])
    || !value.generated_at || !Number.isFinite(Date.parse(value.generated_at as string))
    || !strings(value.insufficient_claims) || !strings(value.next_steps) || !strings(value.conflicts)
    || !Array.isArray(value.confirmed_claims) || !value.confirmed_claims.every((pair) => strings(pair) && pair.length === 2)
    || !Array.isArray(value.jd_requirements) || !Array.isArray(value.claim_reviews) || !value.claim_reviews.length) return false;
  const validClaims = value.claim_reviews.every((item) => record(item) && id(item.claim_id)
    && textFields(item, ["text", "resume_locator", "rationale", "gate_reason", "warning"])
    && ["人工已接受", "人工已拒绝"].includes(item.review_status as string)
    && ["充分支持", "部分支持", "没有证据", "材料冲突", "未判定"].includes(item.verdict as string)
    && ["低", "需关注", "待评估"].includes(item.risk as string) && strings(item.suggestions)
    && Array.isArray(item.evidence) && item.evidence.every((evidence) => record(evidence) && id(evidence.chunk_id)
      && ["project", "supplement"].includes(evidence.source_kind as string)
      && textFields(evidence, ["source_label", "relative_path", "locator", "excerpt"])));
  const claimIds = value.claim_reviews.map((item) => record(item) ? item.claim_id : null);
  return validClaims && new Set(claimIds).size === claimIds.length
    && value.jd_requirements.every((item) => record(item) && textFields(item, ["text", "locator", "status"])
      && strings(item.keywords) && Array.isArray(item.claim_ids) && item.claim_ids.every((claimId) => id(claimId) && claimIds.includes(claimId)));
}
