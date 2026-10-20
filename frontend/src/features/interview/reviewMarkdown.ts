import type { InterviewReview, ReviewPoint } from "./interviewApi";

// Saved/model/user text stays literal: embedded Markdown and HTML must not become document structure.
function literal(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `${fence}text\n${text}\n${fence}`;
}

function prose(text: string): string {
  return text.split(/\r?\n/).map((line) => "> " + line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_\[\]()!#]/g, "\\$&")).join("\n");
}

export function reviewMarkdown(review: InterviewReview, includeOriginals: boolean, exportedAt: string): string {
  const used = new Set<number>();
  const refs = (ids: number[]) => {
    const unique = [...new Set(ids)];
    unique.forEach((id) => used.add(id));
    return unique.length ? `引用：${unique.map((id) => `[E${id}]`).join("、")}` : "";
  };
  const lines = ["# 面试复盘", `导出时间：${exportedAt}`, "模型分析仅供练习参考，不认证能力、项目真实性或个人贡献。", prose(review.notice),
    "## 本轮概况", `完成状态：${review.summary.partial ? "部分完成" : "完整一轮"}；设定题数：${review.summary.question_count}；已回答：${review.summary.answered_count}；已出题未回答：${review.summary.unanswered_count}。`,
    `已练习主张 ID：${review.summary.covered_claim_ids.join("、") || "无"}。练习覆盖不等于能力已验证。`];
  if (review.summary.context_truncated) lines.push("注意：部分上下文因预算缩减，分析只依据保留的信息。");
  lines.push("## 总体结论", prose(review.overall_summary ?? (review.summary.answered_count ? "旧复盘未保存总体结论，不自动重新生成。" : "尚无可分析回答，不生成能力评价。")));
  const points = (title: string, values: ReviewPoint[]) => {
    lines.push(`## ${title}`);
    if (!values.length) lines.push("暂无有依据的结论；不代表不存在问题。");
    values.forEach((point, index) => lines.push(`### ${index + 1}`, prose(point.text),
      `关联回合 ID：${point.turn_ids.join("、") || "无"}；主张 ID：${point.claim_ids.join("、") || "无"}。`, refs(point.evidence_ids)));
  };
  points("学习建议", review.next_steps);
  lines.push("## 逐题复盘");
  [...review.turns].sort((a, b) => a.ordinal - b.ordinal).forEach((turn) => {
    lines.push(`### 第 ${turn.ordinal} 题 · 主张 ${turn.claim_id}`, `题型：${turn.kind === "followup" ? "追问" : "主问题"}${turn.followup_of_turn_id !== null ? `；关联回合 ID：${turn.followup_of_turn_id}` : ""}。`,
      "**题目**", literal(turn.question), "**原回答**", literal(turn.answer ?? "未回答（已出题）"), refs(turn.evidence_ids));
    const analysis = review.turn_reviews.find((item) => item.turn_id === turn.id);
    if (!analysis) { lines.push("此题未保存逐题分析，不自动生成。"); return; }
    const fields: [string, string[]][] = [["有效信息", analysis.strengths], ["还缺什么", analysis.missing_details], ["技术解释（模型分析）", analysis.technical_points], ["如何改进", analysis.suggestions]];
    fields.forEach(([title, values]) => lines.push(`**${title}**`, ...(values.length ? values.map(prose) : ["暂无有依据的结论。"])));
    lines.push(refs(analysis.evidence_ids));
  });
  if (!review.turns.length) lines.push("本轮没有保存的问答。");
  if (review.answer_consistency !== undefined) points("回答前后一致性", review.answer_consistency);
  points(review.answer_consistency !== undefined ? "简历主张对照" : "一致性分析（历史记录，未分类）", review.consistency);
  points("表达遗漏", review.omissions); points("技术缺口（模型分析）", review.technical_gaps);
  lines.push("## 尚未覆盖的主张");
  review.summary.uncovered_claims.forEach((claim) => lines.push(`主张 ID：${claim.id}`, literal(claim.text)));
  if (!review.summary.uncovered_claims.length) lines.push("没有记录为未覆盖的主张，不代表已验证全部能力。");
  lines.push("## 引用来源", includeOriginals ? "已附带被引用的原文；分享前请检查个人信息、内部路径及敏感内容。" : "未附带引用原文；来源名称和路径仍可能包含个人信息，分享前请检查。");
  [...used].sort((a, b) => a - b).forEach((id) => {
    const item = review.evidence.find((value) => value.id === id);
    if (!item) { lines.push(`[E${id}]：当前复盘未保存对应来源`); return; }
    lines.push(`### [E${id}]`, literal(`${item.label}\n${item.relative_path}\n${item.locator}`));
    if (item.kind === "supplement") lines.push("用户补充自述，不是独立证明。");
    if (includeOriginals) lines.push(literal(item.text));
  });
  if (!used.size) lines.push("没有记录引用来源。");
  return lines.filter((line) => line !== "").join("\n\n") + "\n";
}
