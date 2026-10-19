import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { InterviewReviewPage } from "./InterviewReviewPage";
import type { InterviewReview } from "./interviewApi";
import { sessionFixture } from "./interviewFixtures.test-utils";

function reviewFixture(): InterviewReview {
  const point = (text: string) => ({ text, turn_ids: [1], claim_ids: [2], evidence_ids: [8, 8] });
  return {
    summary: { answered_count: 1, unanswered_count: 0, question_count: 1, partial: false, covered_claim_ids: [2], uncovered_claims: [], context_truncated: false },
    turns: [{ ...sessionFixture().turns[0], answer: "不会" }],
    turn_reviews: [{ turn_id: 1, strengths: [], missing_details: ["尚未说明路由"], technical_points: [], suggestions: ["写路由"], evidence_ids: [8, 8] }],
    consistency: [point("材料不足不能认定造假")], omissions: [], technical_gaps: [],
    next_steps: [point("先写路由"), point("先写路由"), point("再做测试"), point("再看部署"), point("最后扩展")],
    evidence: [{ id: 8, text: "app = FastAPI()", kind: "project", label: "app.py", locator: "全文", relative_path: "src/app.py" }], notice: "仅供练习",
  };
}

test("总体结论与去重前三项重点优先展示，逐题默认折叠，引用随分析原地展开", () => {
  const review = { ...reviewFixture(), overall_summary: "本轮尚未展示接口基础。", answer_consistency: [{ text: "本轮回答无直接冲突", turn_ids: [1], claim_ids: [2], evidence_ids: [] }] };
  const { container } = render(<InterviewReviewPage review={review} />);
  expect(screen.getByText("本轮尚未展示接口基础。")).toBeInTheDocument();
  const priorities = screen.getByRole("region", { name: "优先学习" });
  expect(within(priorities).getAllByRole("listitem")).toHaveLength(3);
  expect(within(priorities).queryByText("最后扩展")).not.toBeInTheDocument();
  const turn = screen.getByText(/第 1 题 · 主张 2/).closest("details");
  expect(turn).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText(/第 1 题 · 主张 2/));
  expect(turn).toHaveAttribute("open");
  const firstPriority = within(priorities).getAllByRole("listitem")[0];
  const reference = firstPriority.querySelector("details.interview-reference");
  expect(firstPriority.querySelectorAll("details.interview-reference")).toHaveLength(1);
  expect(reference).not.toHaveAttribute("open");
  fireEvent.click(within(firstPriority).getByText("[E8] app.py · src/app.py · 全文"));
  expect(reference).toHaveAttribute("open");
  expect(within(firstPriority).getByText("app = FastAPI()")).toBeVisible();
  expect(turn?.querySelector("details.interview-reference")).not.toHaveAttribute("open");
  expect(container.querySelector("a[href^='#']")).toBeNull();
  expect(screen.queryByRole("heading", { name: "引用材料" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "回答前后一致性" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "简历主张对照" })).toBeInTheDocument();
});

test("引用原地绑定对应材料，忽略不存在的编号并保留代码与补充自述提示", () => {
  const review = reviewFixture();
  review.consistency = [{ text: "仅为补充自述", turn_ids: [1], claim_ids: [2], evidence_ids: [9, 999, 9] }];
  review.evidence.push({ id: 9, text: 'def health():\n    return {"status": "ok"}', kind: "supplement", label: "补充说明", locator: "全文", relative_path: "用户补充" });
  render(<InterviewReviewPage review={review} />);
  const analysis = screen.getByText("仅为补充自述").closest("article")!;
  expect(analysis.querySelectorAll("details")).toHaveLength(1);
  fireEvent.click(within(analysis).getByText("[E9] 补充说明 · 用户补充 · 全文"));
  expect(analysis.querySelector("pre")?.textContent).toBe('def health():\n    return {"status": "ok"}');
  expect(within(analysis).getByText("用户补充自述，不是独立证明。")).toBeVisible();
  expect(within(analysis).queryByText(/E999|app = FastAPI/)).not.toBeInTheDocument();
});

test("旧复盘不把历史混合一致性结论伪装成简历对照，也不自动编造总评", () => {
  render(<InterviewReviewPage review={reviewFixture()} />);
  expect(screen.getByText(/旧复盘未保存总体结论/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "一致性分析（历史记录，未分类）" })).toBeInTheDocument();
});
