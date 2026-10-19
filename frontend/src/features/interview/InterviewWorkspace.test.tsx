import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InterviewWorkspace } from "./InterviewWorkspace";
import { jsonResponse, sessionFixture } from "./interviewFixtures.test-utils";
import { InterviewSetup } from "./InterviewSetup";

beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("提供默认综合模式，并可展开高级设置", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
  render(<InterviewWorkspace taskId={7} reportReady onChanged={vi.fn()} />);
  expect(await screen.findByText(/默认综合模式/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "使用高级设置" }));
  expect(screen.getByLabelText("题数")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("题数"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("预计时长（分钟，仅参考）"), { target: { value: "15" } });
  const custom = screen.getByRole("group", { name: "自定义练习安排" });
  expect(within(custom).getByText("3 题（含追问）")).toBeVisible();
  expect(within(custom).getByText("预计 15 分钟（仅参考）")).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox", { name: "使用高级设置" }));
  expect(within(screen.getByRole("group", { name: "默认练习安排" })).getByText("5 题（含追问）")).toBeVisible();
  expect(screen.queryByLabelText("题数")).not.toBeInTheDocument();
});

test("默认配置与费用提示分开可读，未开启高级设置仍提交原默认参数", async () => {
  const fetcher = vi.fn().mockResolvedValue(jsonResponse(sessionFixture()));
  vi.stubGlobal("fetch", fetcher);
  const started = vi.fn();
  render(<InterviewSetup taskId={7} onStarted={started} />);
  const defaults = screen.getByRole("group", { name: "默认练习安排" });
  expect(within(defaults).getByText("5 题（含追问）")).toBeVisible();
  expect(within(defaults).getByText("整轮结束后复盘")).toBeVisible();
  expect(screen.getByText(/异常修正或手动重试可能增加费用/)).toBeVisible();
  expect(screen.queryByLabelText("题数")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "开始面试" }));
  await waitFor(() => expect(started).toHaveBeenCalled());
  expect(fetcher).toHaveBeenCalledWith("/api/v2/tasks/7/interviews", expect.objectContaining({ method: "POST" }));
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ mode: "default", question_count: 5, duration_minutes: null, focus_areas: [], request_key: expect.any(String) });
});

test("历史列表按会话绑定题数状态和查看入口，打开复盘只读取对应会话", async () => {
  const review = { summary: { answered_count: 1, unanswered_count: 0, question_count: 3, partial: true, covered_claim_ids: [2], uncovered_claims: [], context_truncated: false }, turns: [], turn_reviews: [], consistency: [], omissions: [], technical_gaps: [], next_steps: [], evidence: [], notice: "历史复盘样例" };
  const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse([
    { id: 9, task_id: 7, version: 2, status: "awaiting_answer", question_count: 5 },
    { id: 8, task_id: 7, version: 2, status: "completed", question_count: 3 },
  ])).mockResolvedValueOnce(jsonResponse(sessionFixture({ question_count: 5 })))
    .mockResolvedValueOnce(jsonResponse(sessionFixture({ id: 8, status: "completed", question_count: 3, review })));
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewWorkspace taskId={7} reportReady onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByText("历史面试 · 2 轮"));
  const history = screen.getByRole("list", { name: "历史面试列表" });
  const rows = within(history).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText("会话 #9")).toBeVisible();
  expect(within(rows[0]).getByText("设定 5 题")).toBeVisible();
  expect(within(rows[0]).getByText("等待作答")).toBeVisible();
  expect(within(rows[1]).getByText("设定 3 题")).toBeVisible();
  expect(within(rows[1]).getByText("已完成")).toBeVisible();
  fireEvent.click(within(rows[1]).getByRole("button", { name: "查看复盘 #8" }));
  expect(await screen.findByText("历史复盘样例")).toBeVisible();
  expect(fetcher).toHaveBeenLastCalledWith("/api/v2/interviews/8", expect.any(Object));
  expect(fetcher.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});

test("报告未生成时解释面试锁定原因且不请求模型", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewWorkspace taskId={7} reportReady={false} onChanged={vi.fn()} />);
  expect(screen.getByText("生成审计报告后可开始模拟面试")).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});
