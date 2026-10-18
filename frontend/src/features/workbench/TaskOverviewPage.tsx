import { WorkspacePage } from "./WorkbenchShell";
import { TaskSnapshot } from "./types";

export function TaskOverviewPage({ snapshot, onNavigate }: { snapshot: TaskSnapshot; onNavigate: (page: WorkspacePage) => void }) {
  const pending = snapshot.claims.filter((claim) => claim.status === "pending_review");
  const reviewed = snapshot.claims.length - pending.length;
  const riskCount = snapshot.claims.filter((claim) => {
    const verdict = snapshot.assessments[String(claim.id)]?.verdict;
    return verdict === "none" || verdict === "conflict";
  }).length;
  const needsMaterials = snapshot.sources.length === 0;
  const needsClaims = snapshot.claims.length === 0;
  const nextPage: WorkspacePage = snapshot.audit.status === "completed"
    ? snapshot.report_ready ? "interview" : "report"
    : needsMaterials || needsClaims ? "materials" : "audit";
  const nextAction = nextPage === "audit" ? "继续审核" : nextPage === "materials" ? "导入材料" : nextPage === "report" ? "生成报告" : "开始模拟面试";
  const nextDescription = snapshot.audit.status === "completed"
    ? snapshot.report_ready ? "报告已就绪，可以开始一轮文字模拟面试。" : "审核已完成，生成报告后即可进入模拟面试。"
    : needsMaterials
      ? "先导入简历、岗位描述或项目材料"
      : needsClaims
        ? "材料已就绪，下一步将从材料中提取能力主张。"
        : "逐条确认能力主张与候选证据。";

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">当前任务</p>
        <h1>任务概览</h1>
        <p>{snapshot.name}</p>
      </header>
      <section className="summary-grid" aria-label="任务统计">
        <article className="summary-card"><span>能力主张总数</span><strong>{snapshot.claims.length}</strong></article>
        <article className="summary-card"><span>待人工确认</span><strong>{pending.length}</strong></article>
        <article className="summary-card"><span>审计进度</span><strong>{reviewed} / {snapshot.claims.length} 条已审核</strong></article>
        <article className="summary-card"><span>高风险或材料不足</span><strong>{riskCount}</strong></article>
      </section>
      <section className="overview-grid">
        <article className="panel">
          <div className="panel-title"><h2>待处理队列</h2><span>{pending.length} 项</span></div>
          {pending.length ? <ul className="queue-list">{pending.slice(0, 5).map((claim) => <li key={claim.id}><strong>{claim.text}</strong><span>来源：{claim.resume_locator}</span></li>)}</ul> : <p>当前没有待审核主张。</p>}
        </article>
        <article className="panel next-action">
          <h2>下一步操作</h2>
          <p>{nextDescription}</p>
          <button className="primary-button" onClick={() => onNavigate(nextPage)} type="button">
            {nextAction}
          </button>
        </article>
      </section>
    </>
  );
}
