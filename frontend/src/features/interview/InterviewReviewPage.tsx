import type { InterviewReview, ReviewPoint } from "./interviewApi";
import { InterviewReviewExport } from "./InterviewReviewExport";

export function InterviewReviewPage({ review, onRestart }: { review: InterviewReview; onRestart?: () => void }) {
  const steps = review.next_steps.filter((point, index, all) => all.findIndex((value) => value.text.trim() === point.text.trim()) === index);
  const sections: [string, ReviewPoint[]][] = [
    ...(review.answer_consistency !== undefined ? [["回答前后一致性", review.answer_consistency] as [string, ReviewPoint[]]] : []),
    [review.answer_consistency !== undefined ? "简历主张对照" : "一致性分析（历史记录，未分类）", review.consistency],
    ["表达遗漏", review.omissions], ["技术缺口（模型分析）", review.technical_gaps],
  ];
  const references = (ids: number[]) => <ReferenceList ids={ids} review={review} />;
  return <section className="interview-review">
    <section className="panel"><div className="interview-progress"><p className="eyebrow">INTERVIEW REVIEW</p><span className="interview-chip">{review.summary.partial ? "部分完成" : "完整一轮"}</span></div><h2>本轮面试复盘</h2><p>{review.notice}</p><div className="interview-metrics"><div><strong>{review.summary.answered_count}</strong><span>已回答</span></div><div><strong>{review.summary.unanswered_count}</strong><span>已出题未回答</span></div><div><strong>{review.summary.covered_claim_ids.length}</strong><span>已练习主张</span></div></div>{review.summary.context_truncated ? <p className="interview-note">部分上下文因预算缩减，分析只依据保留的信息。</p> : null}<InterviewReviewExport review={review} onRestart={onRestart} /></section>
    <section className="panel interview-review-summary"><h2>总体结论</h2><p>{review.overall_summary ?? (review.summary.answered_count ? "旧复盘未保存总体结论，请查看原有逐题分析；不会自动重新生成。" : "尚无可分析回答，不生成能力评价。")}</p><section aria-label="优先学习"><h3>优先学习</h3>{steps.length ? <ol>{steps.slice(0, 3).map((point) => <li key={point.text}>{point.text}{references(point.evidence_ids)}</li>)}</ol> : <p className="muted-copy">暂无有依据的学习建议。</p>}</section>{steps.length > 3 ? <details><summary>其余学习建议</summary><ul>{steps.slice(3).map((point) => <li key={point.text}>{point.text}{references(point.evidence_ids)}</li>)}</ul></details> : null}</section>
    <section className="panel"><h2>逐题复盘</h2>{review.turn_reviews.length ? review.turn_reviews.map((item) => {
      const turn = review.turns.find((value) => value.id === item.turn_id);
      return <details className="interview-turn-review" key={item.turn_id}><summary>第 {turn?.ordinal ?? "?"} 题 · 主张 {turn?.claim_id}</summary><h3>{turn?.question}</h3><div className="interview-answer-quote"><span>你的回答</span><p>{turn?.answer}</p></div>{([["有效信息", item.strengths], ["还缺什么", item.missing_details], ["技术解释（模型分析）", item.technical_points], ["如何改进", item.suggestions]] as [string, string[]][]).map(([title, values]) => <div key={title}><h4>{title}</h4>{values.length ? <ul>{values.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p className="muted-copy">暂无有依据的结论</p>}</div>)}{references(item.evidence_ids)}</details>;
    }) : <p className="interview-note">本轮没有逐题分析。</p>}</section>
    <div className="interview-review-grid">{sections.map(([title, points]) => <section className="panel" key={title}><h2>{title}</h2>{points.length ? points.map((point, index) => <article key={index}><p>{point.text}</p><p className="muted-copy">关联回合：{point.turn_ids.join("、") || "无"} · 主张：{point.claim_ids.join("、") || "无"}</p>{references(point.evidence_ids)}</article>) : <p className="muted-copy">暂无有依据的结论；不代表不存在问题。</p>}</section>)}</div>
    <section className="panel"><h2>尚未覆盖的主张</h2>{review.summary.uncovered_claims.length ? <ul>{review.summary.uncovered_claims.map((claim) => <li key={claim.id}>{claim.text}</li>)}</ul> : <p className="muted-copy">本轮已对全部接受主张作答，不代表已验证全部能力。</p>}</section>
  </section>;
}
function ReferenceList({ ids, review }: { ids: number[]; review: InterviewReview }) {
  const evidence = [...new Set(ids)].flatMap((id) => {
    const item = review.evidence.find((value) => value.id === id);
    return item ? [item] : [];
  });
  if (!evidence.length) return null;
  return <div className="interview-references" role="group" aria-label="引用材料">{evidence.map((item) => <details className="interview-reference" key={item.id}><summary>[E{item.id}] {item.label} · {item.relative_path} · {item.locator}</summary><pre>{item.text}</pre>{item.kind === "supplement" ? <p className="muted-copy">用户补充自述，不是独立证明。</p> : null}</details>)}</div>;
}
