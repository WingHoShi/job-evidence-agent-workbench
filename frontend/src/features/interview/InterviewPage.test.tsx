import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InterviewPage } from "./InterviewPage";
import { InterviewReviewPage } from "./InterviewReviewPage";
import { sessionFixture, jsonResponse } from "./interviewFixtures.test-utils";
import type { InterviewReview } from "./interviewApi";

beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("历史按题独立展开，查看已保存回答不影响当前草稿或发起请求", () => {
  const base = sessionFixture();
  const session = sessionFixture({ turns: [
    { ...base.turns[0], answer: "我负责健康检查接口。" },
    { ...base.turns[0], id: 2, ordinal: 2, kind: "followup", followup_of_turn_id: 1, question: "异常如何验证？", answer: null },
  ] });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewPage session={session} onSessionChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("当前回答"), { target: { value: "先模拟依赖超时" } });
  const history = screen.getByRole("heading", { name: "问答记录" }).closest("aside")!;
  const first = within(history).getByText("接口如何实现？").closest("details")!;
  const second = within(history).getByText("异常如何验证？").closest("details")!;
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first).not.toHaveAttribute("open");
  expect(second).not.toHaveAttribute("open");
  expect(within(first).getByText("我负责健康检查接口。")).not.toBeVisible();
  fireEvent.click(first.querySelector("summary")!);
  expect(within(first).getByText("我负责健康检查接口。")).toBeVisible();
  expect(second).not.toHaveAttribute("open");
  fireEvent.click(second.querySelector("summary")!);
  expect(first).toHaveAttribute("open");
  expect(second).toHaveAttribute("open");
  expect(within(first).getByText("已回答")).toBeVisible();
  expect(within(second).getAllByText("待回答").length).toBeGreaterThan(0);
  expect(screen.getByLabelText("当前回答")).toHaveValue("先模拟依赖超时");
  expect(sessionStorage.getItem("interview-draft:7:9:2")).toBe("先模拟依赖超时");
  expect(fetcher).not.toHaveBeenCalled();
});

test("提交回答后更新下一题，不显示即时评分", async () => {
  const base = sessionFixture();
  const next = sessionFixture({ turns: [{ ...base.turns[0], answer: "我负责接口设计。" }, { ...base.turns[0], id: 2, ordinal: 2, kind: "followup", followup_of_turn_id: 1, question: "异常如何验证？" }] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(next)));
  const update = vi.fn();
  const view = render(<InterviewPage session={base} onSessionChanged={update} />);
  fireEvent.change(screen.getByLabelText("当前回答"), { target: { value: "我负责接口设计。" } });
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(next));
  view.rerender(<InterviewPage session={next} onSessionChanged={update} />);
  expect(screen.getByRole("heading", { name: "异常如何验证？", level: 2 })).toBeInTheDocument();
  expect(screen.getByLabelText("当前回答")).toHaveValue("");
  expect(screen.queryByText(/得分|参考答案/)).not.toBeInTheDocument();
});

test("完整复盘关联原回答并支持明确再练一轮", () => {
  const review: InterviewReview = {
    summary: { answered_count: 1, unanswered_count: 0, question_count: 2, partial: true, covered_claim_ids: [2], uncovered_claims: [{ id: 3, text: "Docker 部署" }], context_truncated: false },
    turns: [{ ...sessionFixture().turns[0], answer: "我负责接口设计。" }],
    turn_reviews: [{ turn_id: 1, strengths: ["说明职责"], missing_details: ["缺少指标"], technical_points: [], suggestions: ["补充异常测试"], evidence_ids: [] }],
    consistency: [], omissions: [], technical_gaps: [], next_steps: [], evidence: [], notice: "模型分析仅供参考",
  };
  const restart = vi.fn();
  render(<InterviewReviewPage review={review} onRestart={restart} />);
  expect(screen.getByRole("heading", { name: "本轮面试复盘" })).toBeInTheDocument();
  expect(screen.getByText("我负责接口设计。")).toBeInTheDocument();
  expect(screen.getByText("缺少指标")).toBeInTheDocument();
  expect(screen.getByText("Docker 部署")).toBeInTheDocument();
  expect(screen.getByText("部分完成")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "再练一轮" }));
  expect(restart).toHaveBeenCalledTimes(1);
});

test("零回答复盘不展示伪造评价", () => {
  const review: InterviewReview = {
    summary: { answered_count: 0, unanswered_count: 1, question_count: 5, partial: true, covered_claim_ids: [], uncovered_claims: [{ id: 2, text: "接口实现" }], context_truncated: false },
    turns: sessionFixture().turns, turn_reviews: [], consistency: [], omissions: [], technical_gaps: [], next_steps: [], evidence: [], notice: "尚无可分析回答，请重新开始一轮练习。",
  };
  render(<InterviewReviewPage review={review} />);
  expect(screen.getByText("尚无可分析回答，不生成能力评价。")).toBeInTheDocument();
  expect(screen.getByText("部分完成")).toBeInTheDocument();
  expect(screen.queryByText("你的回答")).not.toBeInTheDocument();
});
