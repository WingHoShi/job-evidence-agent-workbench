import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InterviewWorkspace } from "./InterviewWorkspace";
import { InterviewPage } from "./InterviewPage";
import { InterviewSetup } from "./InterviewSetup";
import { sessionFixture, jsonResponse } from "./interviewFixtures.test-utils";

beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("刷新恢复已有题号和历史，不创建付费面试", async () => {
  const session = sessionFixture();
  const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse([{ id: 9, task_id: 7, version: 2, status: "awaiting_answer", question_count: 2 }])).mockResolvedValueOnce(jsonResponse(session));
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewWorkspace taskId={7} reportReady onChanged={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "接口如何实现？", level: 2 })).toBeInTheDocument();
  expect(screen.getByText("第 1 / 2 题")).toBeInTheDocument();
  expect(screen.getByText(/问答历史/)).toBeInTheDocument();
  expect(fetcher.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});

test("网络失败保留草稿且重试提交复用操作键", async () => {
  const onChanged = vi.fn();
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce(jsonResponse(sessionFixture({ status: "ready_to_finish", turns: [{ ...sessionFixture().turns[0], answer: "我实现路由" }] })));
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewPage session={sessionFixture()} onSessionChanged={onChanged} />);
  fireEvent.change(screen.getByLabelText("当前回答"), { target: { value: "我实现路由" } });
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/网络|连接/);
  expect(screen.getByLabelText("当前回答")).toHaveValue("我实现路由");
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  const bodies = fetcher.mock.calls.map(([, opts]) => JSON.parse(opts.body));
  expect(bodies[0].request_key).toBe(bodies[1].request_key);
  expect(bodies[0].turn_id).toBe(1);
});

test("回答已保存出题失败时只重试生成，不重交回答", async () => {
  const base = sessionFixture();
  const failed = sessionFixture({ status: "generating_question", turns: [{ ...base.turns[0], answer: "我实现路由" }], operation: { id: 2, kind: "question", state: "failed", attempt_count: 1, safe_error: "模型超时", retry_allowed: true, usage: null } });
  const fetcher = vi.fn().mockResolvedValue(jsonResponse(base));
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewPage session={failed} onSessionChanged={vi.fn()} />);
  expect(screen.getByText(/回答已保存/)).toBeInTheDocument();
  expect(screen.queryByLabelText("当前回答")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试生成（可能计费）" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/v2/interviews/9/retry", expect.objectContaining({ method: "POST" })));
});

test("最后一题答完不再显示可重复提交的表单", () => {
  render(<InterviewPage session={sessionFixture({ status: "ready_to_finish" })} onSessionChanged={vi.fn()} />);
  expect(screen.queryByLabelText("当前回答")).not.toBeInTheDocument();
  expect(screen.getByText(/已完成设定题数/)).toBeInTheDocument();
});

test("提前结束需要确认，取消不产生请求", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewPage session={sessionFixture()} onSessionChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "结束面试并生成复盘" }));
  expect(screen.getByRole("dialog", { name: "提前结束本轮面试？" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "继续作答" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});

test("等待提交期间禁用按钮，不能双击重复生成", async () => {
  const fetcher = vi.fn().mockReturnValue(new Promise(() => {}));
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewPage session={sessionFixture()} onSessionChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("当前回答"), { target: { value: "回答" } });
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  expect(screen.getByRole("button", { name: "提交中…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "结束面试并生成复盘" })).toBeDisabled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("旧版历史仅查看，不伪造复盘", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([{ id: 1, task_id: 7, version: 1, status: "in_progress", question_count: 5 }]))
    .mockResolvedValueOnce(jsonResponse({ session: { task_id: 7 }, turns: [{ id: 1, question: "旧题", answer: null }], review: null })));
  render(<InterviewWorkspace taskId={7} reportReady onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /查看旧版模板面试/ }));
  expect(await screen.findByText("旧题")).toBeInTheDocument();
  expect(screen.getByText(/旧版未保存复盘，无法恢复/)).toBeInTheDocument();
});

test("切换任务丢弃较晚返回的旧会话", async () => {
  let resolveOld!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce(jsonResponse([])));
  const view = render(<InterviewWorkspace taskId={7} reportReady onChanged={vi.fn()} />);
  view.rerender(<InterviewWorkspace taskId={8} reportReady onChanged={vi.fn()} />);
  await screen.findByRole("heading", { name: "开始文字模拟面试" });
  resolveOld(jsonResponse([{ id: 9, task_id: 7, version: 2, status: "awaiting_answer", question_count: 2 }]));
  await waitFor(() => expect(screen.queryByText("接口如何实现？")).not.toBeInTheDocument());
});

test.each([{ turns: [] }, { turns: [{ ...sessionFixture().turns[0], answer: "不同的回答" }] }])("响应未确认保存本页当前回答时不能清除草稿：%j", async ({ turns }) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(sessionFixture({ turns }))));
  render(<InterviewPage session={sessionFixture()} onSessionChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("当前回答"), { target: { value: "保留这份回答" } });
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "提交回答" })).not.toBeDisabled());
  expect(sessionStorage.getItem("interview-draft:7:9:1")).toBe("保留这份回答");
});

test("刷新确认未保存后允许修改回答，不被旧请求键锁死", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce(jsonResponse(sessionFixture()))
    .mockResolvedValueOnce(jsonResponse(sessionFixture({ status: "ready_to_finish", turns: [{ ...sessionFixture().turns[0], answer: "修改后的回答" }] })));
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewPage session={sessionFixture()} onSessionChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("当前回答"), { target: { value: "旧回答" } });
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "提交回答" })).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("当前回答"), { target: { value: "修改后的回答" } });
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetcher.mock.calls[2][1].body).answer).toBe("修改后的回答");
});

test("开始请求失败后可只读刷新，确认未创建再修改选项", async () => {
  const onStarted = vi.fn();
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse(sessionFixture()));
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewSetup taskId={7} onStarted={onStarted} />);
  fireEvent.click(screen.getByRole("button", { name: "开始面试" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "刷新开始状态" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "开始面试" })).not.toBeDisabled());
  fireEvent.click(screen.getByLabelText("使用高级设置"));
  fireEvent.change(screen.getByLabelText("题数"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "开始面试" }));
  await waitFor(() => expect(onStarted).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[2][1].body).question_count).toBe(2);
});

test("另一标签页已保存不同回答时保留并展示本页冲突草稿", () => {
  sessionStorage.setItem("interview-draft:7:9:1", "本页没有保存的回答B");
  const base = sessionFixture();
  render(<InterviewPage session={sessionFixture({ status: "ready_to_finish", turns: [{ ...base.turns[0], answer: "另一标签页的回答A" }] })} onSessionChanged={vi.fn()} />);
  expect(sessionStorage.getItem("interview-draft:7:9:1")).toBe("本页没有保存的回答B");
  expect(screen.getByText("本页没有保存的回答B")).toBeInTheDocument();
  expect(screen.getByText(/服务端已保存不同回答/)).toBeInTheDocument();
});
