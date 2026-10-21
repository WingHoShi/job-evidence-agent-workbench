export type Source = {
  id: number;
  kind: string;
  label: string;
  relative_path: string;
};

export type Claim = {
  id: number;
  text: string;
  resume_locator: string;
  capability_tags: string[];
  status: string;
};

export type Assessment = {
  claim_id: number;
  links: number[];
  verdict: "strong" | "partial" | "none" | "conflict";
  rationale: string;
};

export type Gate = {
  eligible: boolean;
  requires_review: boolean;
  reason: string;
};

export type TaskSnapshot = {
  id: number;
  name: string;
  status: string;
  sources: Source[];
  claims: Claim[];
  assessments: Record<string, Assessment>;
  gates: Record<string, Gate>;
  report_ready: boolean;
  audit: { status: string; claim_id: number | null; events: string[]; recoverable: boolean };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function isId(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function isStrings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }

export function isAssessment(value: unknown): value is Assessment {
  return isRecord(value) && isId(value.claim_id) && Array.isArray(value.links) && value.links.every(isId)
    && ["strong", "partial", "none", "conflict"].includes(value.verdict as string) && typeof value.rationale === "string";
}
export function isGate(value: unknown): value is Gate {
  return isRecord(value) && typeof value.eligible === "boolean" && typeof value.requires_review === "boolean" && typeof value.reason === "string";
}
export function isAuditState(value: unknown): value is { status: string; claim_id: number | null; events: string[] } {
  return isRecord(value) && ["created", "awaiting_review", "completed"].includes(value.status as string)
    && (value.status === "awaiting_review" ? isId(value.claim_id) : value.claim_id === null) && isStrings(value.events);
}
export function isTaskSnapshot(value: unknown): value is TaskSnapshot {
  return isRecord(value) && isId(value.id) && typeof value.name === "string" && typeof value.status === "string"
    && Array.isArray(value.sources) && value.sources.every((source) => isRecord(source) && isId(source.id)
      && typeof source.kind === "string" && typeof source.label === "string" && typeof source.relative_path === "string")
    && Array.isArray(value.claims) && value.claims.every((claim) => isRecord(claim) && isId(claim.id)
      && typeof claim.text === "string" && typeof claim.resume_locator === "string" && isStrings(claim.capability_tags)
      && ["pending_review", "confirmed", "rejected"].includes(claim.status as string))
    && isRecord(value.assessments) && Object.entries(value.assessments).every(([id, assessment]) => isAssessment(assessment) && String(assessment.claim_id) === id)
    && isRecord(value.gates) && Object.values(value.gates).every(isGate)
    && typeof value.report_ready === "boolean" && isRecord(value.audit) && typeof value.audit.recoverable === "boolean" && isAuditState(value.audit);
}
