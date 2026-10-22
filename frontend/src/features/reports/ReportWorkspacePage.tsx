import { useRef, useState } from "react";
import { emptyReportState, isReport, type Report, type ReportViewState } from "./reportTypes";
import { reportMarkdown } from "./reportMarkdown";
let nextRequestId = 0;

export function ReportWorkspacePage({ taskId, auditStatus, onGenerated, state, onStateChange }: { taskId: number; auditStatus: string; onGenerated: () => void | Promise<void>; state?: ReportViewState; onStateChange?: (value: ReportViewState, expectedId: number) => void }) {
  const [local, setLocal] = useState(emptyReportState);
  const [downloadMessage, setDownloadMessage] = useState<{ report: Report; text: string; error: boolean } | null>(null);
  const view = state ?? local;
  const current = useRef(view);
  current.current = view;
  const { report, message, needsSync } = view;
  const busy = view.busy !== null;
  const ready = auditStatus === "completed";
  const download = () => {
    const displayed = current.current.report;
    if (!displayed) return;
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(new Blob([reportMarkdown(displayed)], { type: "text/markdown;charset=utf-8" }));
      anchor = document.createElement("a");
      anchor.href = url; anchor.download = `report-${displayed.task_id}.md`;
      anchor.hidden = true; document.body.appendChild(anchor); anchor.click();
      setDownloadMessage({ report: displayed, text: "已发起下载，内容为当前显示版本；请在浏览器下载列表中确认文件，分享前检查敏感信息。", error: false });
    } catch {
      setDownloadMessage({ report: displayed, text: "未能发起下载，请检查浏览器下载权限后重试；当前报告未改变。", error: true });
    } finally {
      anchor?.remove();
      // Let the browser start reading the object URL before releasing it.
      if (url) { const created = url; const revoke = URL.revokeObjectURL.bind(URL); window.setTimeout(() => revoke(created), 1000); }
    }
  };
  const publish = (next: ReportViewState, expectedId: number) => {
    if (current.current.id !== expectedId) return;
    current.current = next; setLocal(next); onStateChange?.(next, expectedId);
  };
  const synchronize = async (previous: ReportViewState) => {
    try {
      await onGenerated();
      publish({ ...previous, busy: null, needsSync: false, message: null }, previous.id);
    } catch {
      publish({ ...previous, busy: null, needsSync: true, message: "报告已取得，但任务状态刷新失败。请刷新任务状态，不必重新生成报告。" }, previous.id);
    }
  };
  const refreshStatus = async () => {
    const previous = current.current;
    if (previous.busy || !previous.needsSync) return;
    const next: ReportViewState = { ...previous, id: ++nextRequestId, busy: "sync", message: null };
    publish(next, previous.id);
    await synchronize(next);
  };

  const generate = async () => {
    const previous = current.current;
    if (!ready || previous.busy || previous.needsSync) return;
    const next: ReportViewState = { ...previous, id: ++nextRequestId, busy: "report", message: null };
    publish(next, previous.id);
    try {
      const response = await fetch(`/api/tasks/${taskId}/report`);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = (body as { detail?: unknown } | null)?.detail;
        throw new Error(typeof detail === "string" ? detail : "请求未完成，请检查服务状态后重试。");
      }
      if (!isReport(body, taskId)) throw new Error("未能取得有效报告，请核对服务状态后重试。");
      const received: ReportViewState = { ...next, report: body, busy: "sync", needsSync: true };
      publish(received, next.id);
      await synchronize(received);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "请求未完成，请稍后重试。";
      publish({ ...next, busy: null, message: previous.report ? `本次报告刷新未完成，当前仍显示上次取得的报告。${detail}` : detail }, next.id);
    }
  };

  return <section className="report-workspace">
    <header className="page-header"><p className="eyebrow">当前阶段</p><h1>审计报告</h1><p>只汇总已完成逐条审核的能力主张与风险结论。</p></header>
    {!report ? <section className="panel report-toolbar"><div><h2>岗位匹配与证据审计报告</h2>{!ready ? <p>完成全部主张审核后可生成报告</p> : <p>生成后可导出 Markdown，并解锁文字模拟面试。</p>}</div><button className="primary-button" type="button" onClick={generate} disabled={!ready || busy}>{busy ? "正在生成…" : "生成审计报告"}</button></section> : null}
    {message ? <p className="report-warning" role="alert">{message}</p> : null}
    {view.busy === "sync" ? <p className="muted-copy" role="status">报告已取得，正在同步任务状态…</p> : null}
    {needsSync && !busy ? <button className="report-refresh" style={{ marginBottom: 20 }} type="button" onClick={() => void refreshStatus()}>刷新任务状态</button> : null}
    {report ? <div className="report-content">
      <section className="panel report-summary" aria-label="审核摘要">
        <div className="report-toolbar"><div><p className="eyebrow">审核摘要</p><h2>岗位匹配与证据审计报告</h2><p className="muted-copy">生成时间：{report.generated_at}</p></div><div className="report-actions"><button className="report-refresh" type="button" onClick={generate} disabled={!ready || busy || needsSync}>{view.busy === "report" ? "正在生成…" : "刷新报告"}</button><button className="report-download" type="button" onClick={download} title="下载当前显示的报告，不重新生成；分享前请检查敏感信息。">下载 Markdown</button></div></div>
        {downloadMessage?.report === report ? <p className={downloadMessage.error ? "report-warning" : "muted-copy"} role={downloadMessage.error ? "alert" : "status"}>{downloadMessage.text}</p> : null}
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
