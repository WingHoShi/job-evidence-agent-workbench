export type AuditDecision = "accepted" | "rejected" | "supplement";

type Assessment = { verdict: "strong" | "partial" | "none" | "conflict"; rationale: string };
type Gate = { eligible: boolean; requires_review: boolean; reason: string };

const verdictLabels: Record<Assessment["verdict"], string> = {
  strong: "充分支持",
  partial: "部分支持",
  none: "没有证据",
  conflict: "材料冲突",
};

export function ClaimReviewCard({
  claim,
  locator,
  evidence,
  risk,
  assessment,
  gate,
  onDecision,
}: {
  claim: string;
  locator: string;
  evidence: string[];
  risk: string;
  assessment?: Assessment;
  gate?: Gate;
  onDecision: (decision: AuditDecision) => void;
}) {
  return (
    <article>
      <h3>当前审核主张</h3>
      <p>{claim}</p>
      <p>简历定位：{locator}</p>
      <h4>候选证据</h4>
      <ul>{evidence.length ? evidence.map((item) => <li key={item}>{item}</li>) : <li>尚未加载候选证据</li>}</ul>
      {assessment ? <><p>支持程度：{verdictLabels[assessment.verdict]}</p><p>判定说明：{assessment.rationale}</p></> : <p>尚未运行证据判定</p>}
      {gate ? <p>门禁结果：{gate.reason}</p> : null}
      <p>风险：{risk}</p>
      <button type="button" onClick={() => onDecision("accepted")}>接受并继续</button>{" "}
      <button type="button" onClick={() => onDecision("rejected")}>拒绝并继续</button>{" "}
      <button type="button" onClick={() => onDecision("supplement")}>补充证据</button>
    </article>
  );
}
