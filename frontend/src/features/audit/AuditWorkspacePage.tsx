import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { TaskSnapshot } from "../workbench/types";

type Evidence = { id: number; text: string; locator: string };

const verdictLabel = {
  strong: "充分支持",
  partial: "部分支持",
  none: "没有证据",
  conflict: "材料冲突",
} as const;

function AuditConfirmDialog({ title, children, tone, confirmLabel, busy, error, onCancel, onConfirm }: {
  title: string; children: ReactNode; tone: "danger" | "warning" | "primary";
  confirmLabel: string; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="audit-modal-backdrop">
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="audit-modal-card" onKeyDown={(event) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); }
      if (event.key === "Tab") {
        const buttons = ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if (!buttons?.length) { event.preventDefault(); return; }
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className={`audit-modal-icon tone-${tone}`} aria-hidden="true">{tone === "primary" ? "↶" : "!"}</div>
      <h2 id={titleId}>{title}</h2>
      <div className="audit-modal-copy">{children}</div>
      {error ? <p role="alert" className="audit-feedback is-error">{error}</p> : null}
      <footer className="audit-modal-footer">
        <button className="audit-button" type="button" onClick={onCancel} disabled={busy}>取消</button>
        <button className={`audit-button audit-button-${tone}`} type="button" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </footer>
    </section>
  </div>;
}

export function AuditWorkspacePage({ snapshot, onChanged }: { snapshot: TaskSnapshot; onChanged: () => void | Promise<void> }) {
  const [selectedId, setSelectedId] = useState<number | null>(snapshot.audit.claim_id ?? snapshot.claims[0]?.id ?? null);
  const [evidence, setEvidence] = useState<Record<number, Evidence[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [supplement, setSupplement] = useState("");
  const [showSupplement, setShowSupplement] = useState(false);

  const selectedClaim = snapshot.claims.find((claim) => claim.id === selectedId) ?? null;
  const assessment = selectedClaim ? snapshot.assessments[String(selectedClaim.id)] : undefined;
  const gate = selectedClaim ? snapshot.gates[String(selectedClaim.id)] : undefined;
  const isCurrentAuditClaim = selectedClaim?.id === snapshot.audit.claim_id;

  const selectClaim = (id: number) => {
    if (busy) return;
    setSelectedId(id); setConfirmAccept(false); setConfirmUndo(false); setConfirmReject(false);
  };

  const request = async (url: string, options: RequestInit) => {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    if (!response.ok) throw new Error(body?.detail || "操作失败，请稍后重试");
    return body;
  };

  const runAssessment = async () => {
    if (!selectedClaim) return;
    setBusy(true); setMessage(null); setIsError(false);
    try {
      const result = await request(`/api/tasks/${snapshot.id}/claims/${selectedClaim.id}/assessment`, { method: "POST" }) as { evidence?: Evidence[] } | null;
      setEvidence((current) => ({ ...current, [selectedClaim.id]: result?.evidence || [] }));
      setMessage("候选证据判定已完成");
      await onChanged();
    } catch (error) {
      setIsError(true); setMessage(error instanceof Error ? error.message : "证据判定失败，请重试");
    } finally { setBusy(false); }
  };

  const startAudit = async () => {
    setBusy(true); setMessage(null); setIsError(false);
    try {
      await request(`/api/tasks/${snapshot.id}/audit/start`, { method: "POST" });
      setMessage("已开始逐条审核");
      await onChanged();
    } catch (error) {
      setIsError(true); setMessage(error instanceof Error ? error.message : "启动审核失败，请重试");
    } finally { setBusy(false); }
  };

  const submitDecision = async (decision: "accepted" | "rejected" | "supplement", riskAcknowledged = false) => {
    if (!selectedClaim || !isCurrentAuditClaim) return;
    setBusy(true); setMessage(null); setIsError(false);
    try {
      await request(`/api/tasks/${snapshot.id}/audit/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, claim_id: selectedClaim.id, risk_acknowledged: riskAcknowledged, supplemental_text: decision === "supplement" ? supplement : undefined }),
      });
      setSupplement(""); setConfirmReject(false); setConfirmAccept(false);
      setMessage(decision === "supplement" ? "补充证据已保存" : "审核结果已保存");
      await onChanged();
    } catch (error) {
      setIsError(true); setMessage(error instanceof Error ? error.message : "审核保存失败，请重试");
    } finally { setBusy(false); }
  };

  const acceptClaim = () => {
    if (!assessment || !gate || !gate.eligible || gate.requires_review) setConfirmAccept(true);
    else void submitDecision("accepted");
  };

  const undoReview = async () => {
    if (!selectedClaim) return;
    setBusy(true); setMessage(null); setIsError(false);
    try {
      await request(`/api/tasks/${snapshot.id}/claims/${selectedClaim.id}/undo-review`, { method: "POST" });
      setConfirmUndo(false);
      setMessage("已撤销审核，返回待审核");
      await onChanged();
    } catch (error) {
      setIsError(true); setMessage(error instanceof Error ? error.message : "撤销失败，请重试");
    } finally { setBusy(false); }
  };

  return (
    <section className="audit-workspace">
      <header className="page-header"><p className="eyebrow">当前阶段</p><h1>证据审计</h1><p>逐条核验简历中的能力主张，并保留可追溯的审核结论。</p></header>
      {snapshot.audit.status === "created" ? <section className="panel action-panel"><h2>开始审核</h2><p>提取完成后，按主张逐条确认、拒绝或补充证据。</p><button className="primary-button" type="button" onClick={startAudit} disabled={busy || !snapshot.claims.length}>开始逐条审核</button></section> : null}
      <section className="audit-grid">
        <article className="panel table-panel">
          <div className="panel-title"><h2>能力主张</h2><span>共 {snapshot.claims.length} 条 · 待审核 {snapshot.claims.filter((claim) => claim.status === "pending_review").length} 条</span></div>
          <div className="table-scroll"><table>
            <thead><tr><th>主张</th><th>证据数量</th><th>支持度</th><th>风险等级</th><th>审核状态</th><th>操作</th></tr></thead>
            <tbody>{snapshot.claims.map((claim) => {
              const claimAssessment = snapshot.assessments[String(claim.id)];
              const claimGate = snapshot.gates[String(claim.id)];
              const riskLabel = !claimAssessment || !claimGate ? "待评估" : claimGate.requires_review ? "需关注" : "低";
              const verdictTone = !claimAssessment ? "neutral" : claimAssessment.verdict === "strong" ? "primary" : claimAssessment.verdict === "conflict" ? "danger" : "warning";
              return <tr key={claim.id} role="row" tabIndex={0} aria-selected={claim.id === selectedId} className={claim.id === selectedId ? "is-selected" : ""} onClick={() => selectClaim(claim.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectClaim(claim.id); } }}>
                <td>{claim.text}</td><td><span className="audit-evidence-count">{claimAssessment?.links.length || 0}</span></td>
                <td><span className={`audit-badge tone-${verdictTone}`}>{claimAssessment ? verdictLabel[claimAssessment.verdict] : "未判定"}</span></td>
                <td><span className={`audit-badge tone-${riskLabel === "待评估" ? "neutral" : riskLabel === "需关注" ? "warning" : "primary"}`}>{riskLabel}</span></td>
                <td><span className={`audit-badge tone-${claim.status === "pending_review" ? "neutral" : claim.status === "confirmed" ? "primary" : "danger"}`}>{claim.status === "pending_review" ? "待审核" : claim.status === "confirmed" ? "已接受" : "已拒绝"}</span></td>
                <td><button className="audit-button audit-button-small" type="button" onClick={(event) => { event.stopPropagation(); selectClaim(claim.id); }}>查看</button></td>
              </tr>;
            })}</tbody>
          </table></div>
          {snapshot.claims.length === 0 ? <p className="audit-empty">还没有可审核的能力主张，请先返回材料中心提取。</p> : null}
        </article>
        <article className="panel audit-detail">
          <h2>主张详情</h2>
          {selectedClaim ? <>
            <div className="audit-claim-summary"><p className="detail-claim">{selectedClaim.text}</p><p className="muted-copy">来源：{selectedClaim.resume_locator}</p></div>
            <section className={`audit-gate-panel ${!gate || gate.requires_review ? "needs-review" : ""}`}>
              <h3>审核提示</h3><p className="audit-gate-reason">{gate?.reason || "尚未运行判定"}</p>
              <p>{assessment ? `支持程度：${verdictLabel[assessment.verdict]}。${assessment.rationale}` : "运行候选证据判定后，将显示支持程度与理由。"}</p>
            </section>
            {!assessment ? <button className="audit-button audit-button-primary" type="button" onClick={runAssessment} disabled={busy}>运行候选证据判定</button> : null}
            {isCurrentAuditClaim ? <div className="audit-actions">
              <div className="audit-decision-buttons" role="group" aria-label="人工审核"><span className="audit-decision-label">人工审核</span><div className="audit-decision-controls"><button className="audit-button audit-decision-button is-accept" type="button" onClick={acceptClaim} disabled={busy}>接受主张</button><button className="audit-button audit-decision-button is-reject" type="button" onClick={() => setConfirmReject(true)} disabled={busy}>拒绝主张</button></div></div>
              <div className="audit-secondary-actions"><button className="audit-text-action" type="button" aria-expanded={showSupplement} onClick={() => setShowSupplement(!showSupplement)} disabled={busy}>{showSupplement ? "收起补充证据" : "补充证据"}</button>{assessment && selectedClaim.status === "pending_review" ? <button className="audit-text-action" type="button" onClick={runAssessment} disabled={busy}>重新判定当前主张</button> : null}</div>
              {assessment && selectedClaim.status === "pending_review" ? <p className="audit-operation-note">重新判定更新支持程度与审核提示，不改变人工决定；有候选材料时会调用模型。</p> : null}
              {showSupplement ? <div className="audit-supplement-form"><label htmlFor="supplement">补充说明</label><textarea id="supplement" value={supplement} onChange={(event) => setSupplement(event.target.value)} placeholder="补充可核验的项目事实或材料说明" /><button className="audit-button" type="button" onClick={() => submitDecision("supplement")} disabled={busy || !supplement.trim()}>保存补充证据</button></div> : null}
            </div> : <p className="muted-copy">{selectedClaim.status === "pending_review" ? "请先完成当前审核主张后再处理其他条目。" : "本条已审核，可在生成报告前撤销人工决定。"}</p>}
            {selectedClaim.status !== "pending_review" ? <><button className="audit-button" type="button" onClick={() => setConfirmUndo(true)} disabled={busy || snapshot.report_ready}>撤销审核，返回待审核</button>{snapshot.report_ready ? <p className="muted-copy">已生成报告，暂不支持撤销审核。</p> : null}</> : null}
            <section className="audit-detail-section audit-originals">
              <div className="panel-title"><h3>候选证据</h3><span>展开核对原文</span></div>
              <ul className="audit-evidence-list">{(evidence[selectedClaim.id] || []).length ? evidence[selectedClaim.id].map((item) => <li key={item.id}><details><summary>{item.locator}</summary><p>{item.text}</p></details></li>) : <li className="audit-empty">{evidence[selectedClaim.id] ? "已检索，没有可核验的候选证据" : "本次判定后，可在这里展开候选原文。"}</li>}</ul>
            </section>
          </> : <p className="audit-empty">选择一条主张后查看详情。</p>}
        </article>
      </section>
      {confirmReject ? <AuditConfirmDialog title="确认拒绝主张" tone="danger" confirmLabel="确认拒绝" busy={busy} error={isError ? message : null} onConfirm={() => submitDecision("rejected")} onCancel={() => setConfirmReject(false)}><p className="audit-modal-claim">{selectedClaim?.text}</p><p>拒绝后，该能力主张不会进入报告中的已采信证据。</p></AuditConfirmDialog> : null}
      {confirmAccept ? <AuditConfirmDialog title="确认接受风险主张" tone="warning" confirmLabel="确认风险并接受" busy={busy} error={isError ? message : null} onConfirm={() => submitDecision("accepted", true)} onCancel={() => setConfirmAccept(false)}><p className="audit-modal-claim">{selectedClaim?.text}</p><p>{gate?.reason || "该主张尚未完成证据判定"}。接受仅记录你的人工决定，不会把证据不足改成证据充分。</p></AuditConfirmDialog> : null}
      {confirmUndo ? <AuditConfirmDialog title="确认撤销审核" tone="primary" confirmLabel="确认撤销" busy={busy} error={isError ? message : null} onConfirm={undoReview} onCancel={() => setConfirmUndo(false)}><p className="audit-modal-claim">{selectedClaim?.text}</p><p>将撤销本条人工决定，返回待审核并切回这条主张。证据判定、材料和历史记录会保留；重新审核后可再次接受或拒绝。</p></AuditConfirmDialog> : null}
      {message && !(isError && (confirmReject || confirmAccept || confirmUndo)) ? <p className={`audit-feedback ${isError ? "is-error" : ""}`} role={isError ? "alert" : "status"}>{message}</p> : null}
    </section>
  );
}
