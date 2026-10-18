import { ClaimReviewCard, AuditDecision } from "./ClaimReviewCard";

type Claim = { id: number; text: string; resume_locator: string };
type Evidence = { id: number; text: string; locator: string };
type Assessment = { verdict: "strong" | "partial" | "none" | "conflict"; rationale: string };
type Gate = { eligible: boolean; requires_review: boolean; reason: string };

export function AuditPage({
  claim,
  evidence,
  assessment,
  gate,
  events,
  onDecision,
}: {
  claim: Claim | null;
  evidence: Evidence[];
  assessment?: Assessment;
  gate?: Gate;
  events: string[];
  onDecision: (decision: AuditDecision) => void;
}) {
  return (
    <section>
      <h2>逐条证据审核</h2>
      {claim ? <ClaimReviewCard claim={claim.text} locator={claim.resume_locator} evidence={evidence.map((item) => `${item.locator}：${item.text}`)} risk="候选材料只能说明支持关系，需人工确认个人实际职责。" assessment={assessment} gate={gate} onDecision={onDecision} /> : <p>当前没有待审核主张。</p>}
      <h3>执行轨迹</h3>
      {events.map((event, index) => <p key={`${event}-${index}`}>{event}</p>)}
    </section>
  );
}
