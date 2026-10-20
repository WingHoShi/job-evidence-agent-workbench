import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InterviewReviewPage } from "./InterviewReviewPage";
import type { InterviewReview } from "./interviewApi";

function fixture(): InterviewReview {
  const point = { text: "先练习路由", turn_ids: [1], claim_ids: [2], evidence_ids: [8] };
  return {
    overall_summary: "能说出框架用途，尚未解释部署。", answer_consistency: [],
    summary: { answered_count: 1, unanswered_count: 1, question_count: 3, partial: true, covered_claim_ids: [2], uncovered_claims: [{ id: 3, text: "容器部署" }], context_truncated: true },
    turns: [
      { id: 1, ordinal: 1, claim_id: 2, kind: "main", followup_of_turn_id: null, question: "如何实现接口？", answer: '第一行\n```python\n<script>alert("test")</script>\n```\n最后一行', evidence_ids: [8] },
      { id: 2, ordinal: 2, claim_id: 3, kind: "followup", followup_of_turn_id: 1, question: "如何部署？", answer: null, evidence_ids: [] },
    ],
    turn_reviews: [{ turn_id: 1, strengths: ["知道框架用途"], missing_details: ["缺少路由实现"], technical_points: ["路由关联处理函数"], suggestions: ["写最小示例"], evidence_ids: [8, 8, 999] }],
    consistency: [], omissions: [point], technical_gaps: [point], next_steps: [point],
    evidence: [
      { id: 8, text: '原文示例\n    return {"status": "ok"}', kind: "supplement", locator: "全文", label: "补充材料", relative_path: "health/app.py" },
      { id: 9, text: "未被引用的敏感材料", kind: "project", locator: "全文", label: "不应导出的材料", relative_path: "private.md" },
    ], notice: "模型分析仅供练习参考，不认证能力或贡献。",
  };
}

let blobs: Blob[];
let downloads: { name: string; href: string }[];
beforeEach(() => {
  blobs = []; downloads = [];
  class DownloadURL extends URL {
    static createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:local-review"; });
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", DownloadURL);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Export must be offline"); }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function text(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob);
  });
}

test("先展示隐私提示，确认后才下载；默认不附带原文，不请求接口或修改复盘", async () => {
  const review = fixture(); const before = JSON.stringify(review);
  render(<InterviewReviewPage review={review} />);
  fireEvent.click(screen.getByRole("button", { name: "导出复盘" }));
  expect(screen.getByText(/原回答与来源路径可能包含个人信息/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /附带引用原文/ })).not.toBeChecked();
  expect(blobs).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "确认下载 Markdown" }));
  expect(downloads).toHaveLength(1);
  expect(downloads[0].name).toMatch(/^interview-review-[\dTZ-]+\.md$/);
  expect(downloads[0].href).toBe("blob:local-review");
  expect(blobs[0].type).toBe("text/markdown;charset=utf-8");
  const markdown = await text(blobs[0]);
  expect(markdown).toContain("能说出框架用途，尚未解释部署。");
  expect(markdown).toContain(review.turns[0].answer);
  expect(markdown).toContain('````text\n第一行\n```python\n<script>alert("test")</script>\n```\n最后一行\n````');
  expect(markdown).toContain("health/app.py");
  expect(markdown).not.toContain("原文示例");
  expect(markdown).not.toContain("未被引用的敏感材料");
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(review)).toBe(before);
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-review"), { timeout: 2000 });
});

test("显式附带原文后引用去重、原文完整保留，未保存来源不编造", async () => {
  render(<InterviewReviewPage review={fixture()} />);
  fireEvent.click(screen.getByRole("button", { name: "导出复盘" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /附带引用原文/ }));
  fireEvent.click(screen.getByRole("button", { name: "确认下载 Markdown" }));
  const markdown = await text(blobs[0]);
  expect(markdown).toContain('原文示例\n    return {"status": "ok"}');
  expect(markdown.match(/### \[E8\]/g)).toHaveLength(1);
  expect(markdown).toContain("用户补充自述，不是独立证明");
  expect(markdown).toContain("[E999]：当前复盘未保存对应来源");
  expect(markdown).not.toContain("private.md");
});

test("部分完成和旧复盘按原记录导出，包含未回答问题和全部学习建议，不编造总评", async () => {
  const review = fixture(); delete review.overall_summary; delete review.answer_consistency;
  review.next_steps = [1, 2, 3, 4].map((i) => ({ text: `学习步骤${i}`, turn_ids: [1], claim_ids: [2], evidence_ids: [] }));
  render(<InterviewReviewPage review={review} />);
  fireEvent.click(screen.getByRole("button", { name: "导出复盘" }));
  fireEvent.click(screen.getByRole("button", { name: "确认下载 Markdown" }));
  const markdown = await text(blobs[0]);
  for (const value of ["部分完成", "上下文", "旧复盘未保存总体结论", "一致性分析（历史记录，未分类）", "如何部署？", "未回答", "学习步骤4", "容器部署"]) expect(markdown).toContain(value);
  expect(markdown).not.toContain("回答前后一致性");
});

test("关闭导出选项不下载且再次打开恢复默认隐私选项", () => {
  render(<InterviewReviewPage review={fixture()} />);
  fireEvent.click(screen.getByRole("button", { name: "导出复盘" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /附带引用原文/ }));
  fireEvent.click(screen.getByRole("button", { name: "导出复盘" }));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "导出复盘" }));
  expect(screen.getByRole("checkbox", { name: /附带引用原文/ })).not.toBeChecked();
  expect(blobs).toHaveLength(0);
});

test("无已回答内容时可导出原状态，不生成能力评价", async () => {
  const review = fixture();
  review.summary.answered_count = 0; review.summary.covered_claim_ids = [];
  review.turns = []; review.turn_reviews = []; review.next_steps = [];
  delete review.overall_summary;
  render(<InterviewReviewPage review={review} />);
  fireEvent.click(screen.getByRole("button", { name: "导出复盘" }));
  fireEvent.click(screen.getByRole("button", { name: "确认下载 Markdown" }));
  const markdown = await text(blobs[0]);
  expect(markdown).toContain("尚无可分析回答，不生成能力评价");
  expect(markdown).toContain("本轮没有保存的问答");
  expect(markdown).not.toContain("知道框架用途");
});

test("模型分析里的HTML和图片语法作为文字导出，不成为可执行或远程加载内容", async () => {
  const review = fixture(); review.overall_summary = '<img src="https://example.com/pixel">\n![tracking](https://example.com/pixel)';
  render(<InterviewReviewPage review={review} />);
  fireEvent.click(screen.getByRole("button", { name: "导出复盘" }));
  fireEvent.click(screen.getByRole("button", { name: "确认下载 Markdown" }));
  const markdown = await text(blobs[0]);
  expect(markdown).toContain('&lt;img src="https://example.com/pixel"&gt;');
  expect(markdown).toContain('\\!\\[tracking\\]\\(https://example.com/pixel\\)');
});

test("浏览器下载失败时保留复盘、显示错误并释放临时链接", async () => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("download unavailable"); });
  render(<InterviewReviewPage review={fixture()} />);
  fireEvent.click(screen.getByRole("button", { name: "导出复盘" }));
  fireEvent.click(screen.getByRole("button", { name: "确认下载 Markdown" }));
  expect(screen.getByRole("alert")).toHaveTextContent("未能发起下载");
  expect(screen.getByText("能说出框架用途，尚未解释部署。")).toBeInTheDocument();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-review"), { timeout: 2000 });
});
