import type { Report } from "./reportTypes";

// Keep the backend export's common redactions, with a drive boundary so HTTPS URLs stay intact.
function safeText(text: string): string {
  return text.replace(/\b[A-Za-z]:[\\/][^\s）)]+/g, "[本机路径已隐藏]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[密钥已隐藏]")
    .replace(/\b(api[_ -]?key|token|secret)\s*[:=]\s*\S+/gi, "$1=[敏感信息已隐藏]");
}

function prose(text: string): string {
  return safeText(text).split(/\r?\n/).map((line) => "> " + line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_\[\]()!#]/g, "\\$&")).join("\n");
}

function literal(text: string): string {
  const safe = safeText(text);
  const runs = safe.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `${fence}text\n${safe}\n${fence}`;
}

export function reportMarkdown(report: Report): string {
  const lines = ["# 岗位匹配与证据审计报告", prose(`生成时间：${report.generated_at}`),
    "仅导出当前显示的报告版本，不重新生成或修改任务状态。已处理常见密钥和本机路径，但不保证完整匿名化；报告及引用可能含个人信息，分享前请自行检查。",
    "人工接受不等于证据充分；未找到证据不代表能力主张虚假。本报告不认证项目真实性或个人贡献。",
    "## 审核摘要", `人工接受：${report.claim_reviews.filter((item) => item.review_status === "人工已接受").length}；人工拒绝：${report.claim_reviews.filter((item) => item.review_status === "人工已拒绝").length}；需补证或复核：${report.claim_reviews.filter((item) => item.risk !== "低").length}。`,
    "## 逐条审计结论"];
  for (const item of report.claim_reviews) {
    lines.push(`### 主张 ${item.claim_id}`, prose(item.text), "**简历定位**", prose(item.resume_locator),
      "**人工决定**", prose(item.review_status), "**证据支持度**", prose(item.verdict), "**风险提示**", prose(item.risk),
      "**判定理由**", prose(item.rationale), "**审核提示**", prose(item.gate_reason));
    if (item.warning) lines.push("**提醒**", prose(item.warning));
    lines.push("**本条建议**", ...(item.suggestions.length ? item.suggestions.map(prose) : ["暂无本条建议。"]),
      `**可核验证据 · ${item.evidence.length} 条**`);
    for (const evidence of item.evidence) {
      lines.push(`#### [E${evidence.chunk_id}]`,
        evidence.source_kind === "project" ? "项目材料（不代表真实性或个人贡献认证）" : "用户补充说明（非独立证明）",
        prose(`${evidence.source_label} · ${evidence.relative_path || "粘贴材料"} · ${evidence.locator}`), literal(evidence.excerpt));
    }
    if (!item.evidence.length) lines.push("暂无合规引用；请结合判定理由补充材料。");
  }
  lines.push("## 岗位要求覆盖（规则初筛）", prose(report.jd_coverage));
  report.jd_requirements.forEach((item, index) => lines.push(`### 岗位条目 ${index + 1}`, prose(item.text), prose(item.status),
    prose(`${item.locator} · 关键词：${item.keywords.join("、") || "未识别"} · 关联主张：${item.claim_ids.join("、") || "无"}`)));
  if (!report.jd_requirements.length) lines.push("暂无可分析的岗位条目，请导入或核对岗位描述。");
  lines.push("## 冲突材料", ...(report.conflicts.length ? report.conflicts.map(prose) : ["暂无已记录冲突，不代表已证明不存在冲突。"]),
    "## 下一步建议", ...(report.next_steps.length ? report.next_steps.map(prose) : ["暂无待补证项；建议结合原始材料准备技术追问。"]));
  return lines.join("\n\n") + "\n";
}
