import { useState } from "react";

type Report = {
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

export function ReportWorkspacePage({ taskId, auditStatus, onGenerated }: { taskId: number; auditStatus: string; onGenerated: () => void | Promise<void> }) {
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = auditStatus === "completed";

  const generate = async () => {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/report`);
      const body = await response.json().catch(() => null) as Report & { detail?: string } | null;
      if (!response.ok) throw new Error(body?.detail || "报告生成失败，请稍后重试");
      setReport(body);
      await onGenerated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "报告生成失败，请稍后重试");
    } finally { setBusy(false); }
  };

  return <section className="report-workspace">
    <header className="page-header"><p className="eyebrow">当前阶段</p><h1>审计报告</h1><p>只汇总已完成逐条审核的能力主张与风险结论。</p></header>
    {!report ? <section className="panel report-toolbar"><div><h2>岗位匹配与证据审计报告</h2>{!ready ? <p>完成全部主张审核后可生成报告</p> : <p>生成后可导出 Markdown，并解锁文字模拟面试。</p>}</div><button className="primary-button" type="button" onClick={generate} disabled={!ready || busy}>{busy ? "正在生成…" : "生成审计报告"}</button></section> : null}
    {message ? <p className="report-warning" role="alert">{message}</p> : null}
    {report ? <div className="report-content">
      <section className="panel report-summary" aria-label="审核摘要">
        <div className="report-toolbar"><div><p className="eyebrow">审核摘要</p><h2>岗位匹配与证据审计报告</h2><p className="muted-copy">生成时间：{report.generated_at}</p></div><div className="report-actions"><button className="report-refresh" type="button" onClick={generate} disabled={!ready || busy}>{busy ? "正在生成…" : "刷新报告"}</button><a className="report-download" href={`/api/tasks/${taskId}/report.md`}>下载 Markdown</a></div></div>
        <div className="report-metrics">
          <span>人工接受 <strong>{report.claim_reviews.filter((item) => item.review_status === "人工已接受").length}</strong></span>
          <span>人工拒绝 <strong>{report.claim_reviews.filter((item) => item.review_status === "人工已拒绝").length}</strong></span>
          <span>需补证或复核 <strong>{report.claim_reviews.filter((item) => item.risk !== "低").length}</strong></span>
        </div>
        <p className="report-disclaimer">人工接受不等于证据充分；未找到证据不代表能力主张虚假。本报告不认证项目真实性或个人贡献。</p>
      </section>
      <section className="report-claims" aria-label="逐条审计结论">
        {report.claim_reviews.map((item) => <article className="panel report-claim" key={item.claim_id}>
          <h2>主张 {item.claim_id} · {item.text}</h2>
          <p className="muted-copy">简历定位：{item.resume_locator}</p>
          <div className="report-labels">
            <div><span className="report-field-label">人工决定</span><span className={item.review_status === "人工已拒绝" ? "report-label danger" : "report-label"}>{item.review_status}</span></div>
            <div><span className="report-field-label">证据支持</span><span className={item.verdict === "充分支持" ? "report-label" : "report-label warning"}>{item.verdict}</span></div>
            <div><span className="report-field-label">风险提示</span><span className={item.risk === "低" ? "report-label" : "report-label warning"}>风险：{item.risk}</span></div>
          </div>
          {item.warning ? <p className="report-warning">{item.warning}</p> : null}
          <details className="report-claim-details"><summary>判定详情与建议</summary>
            <dl><dt>判定理由</dt><dd>{item.rationale}</dd><dt>审核提示</dt><dd>{item.gate_reason}</dd></dl>
            {item.suggestions.length ? <><h3>本条建议</h3><ul>{item.suggestions.map((text) => <li key={text}>{text}</li>)}</ul></> : null}
          </details>
          <h3>可核验证据 · {item.evidence.length} 条</h3>
          {item.evidence.length ? <ul className="report-evidence">{item.evidence.map((evidence) => <li key={evidence.chunk_id}>
            <details><summary>[E{evidence.chunk_id}] {evidence.source_label} · {evidence.relative_path || "粘贴材料"} · {evidence.locator}</summary>
              <p className="muted-copy">{evidence.source_kind === "project" ? "项目材料（不代表真实性或个人贡献认证）" : "用户补充说明（非独立证明）"}</p>
              <pre>{evidence.excerpt}</pre>
            </details>
          </li>)}</ul> : <p className="muted-copy">暂无合规引用；请结合判定理由补充材料。</p>}
        </article>)}
      </section>
      <section className="panel"><h2>岗位要求覆盖（规则初筛）</h2><p className="muted-copy">{report.jd_coverage}</p>
        {report.jd_requirements.length ? <ul className="report-requirements">{report.jd_requirements.map((item, index) => <li key={index}>
          <strong>{item.text}</strong><span className="report-label warning">{item.status}</span>
          <p className="muted-copy">{item.locator} · 关键词：{item.keywords.join("、") || "未识别"} · 关联主张：{item.claim_ids.join("、") || "无"}</p>
        </li>)}</ul> : <p>暂无可分析的岗位条目，请导入或核对岗位描述。</p>}
      </section>
      <section className="report-grid">
        <article className="panel"><h2>冲突材料</h2>{report.conflicts.length ? <ul>{report.conflicts.map((text) => <li key={text}>{text}</li>)}</ul> : <p className="muted-copy">暂无已记录冲突，不代表已证明不存在冲突。</p>}</article>
        <article className="panel report-next-steps"><h2>下一步建议</h2>{report.next_steps.length ? <ul>{report.next_steps.map((text) => <li key={text}>{text}</li>)}</ul> : <p className="muted-copy">暂无待补证项；建议结合原始材料准备技术追问。</p>}</article>
      </section>
    </div> : null}
  </section>;
}
