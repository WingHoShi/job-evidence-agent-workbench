import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InterviewWorkspace } from "./InterviewWorkspace";
import { jsonResponse, sessionFixture } from "./interviewFixtures.test-utils";

const rows = [
  { id: 9, task_id: 7, version: 2, status: "awaiting_answer", question_count: 2 },
  { id: 8, task_id: 7, version: 2, status: "awaiting_answer", question_count: 2 },
  { id: 6, task_id: 7, version: 2, status: "awaiting_answer", question_count: 2 },
  { id: 8, task_id: 7, version: 1, status: "completed", question_count: 2 },
];
function historical(id: number) { return sessionFixture({ id, turns: [{ ...sessionFixture().turns[0], id: id * 10, question: `历史会话${id}的问题` }] }); }
function deferred() {
  let resolve!: (value: Response) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Handler = (url: string, options?: RequestInit) => Response | Promise<Response>;
async function open(handler: Handler) {
  const requests: { url: string; options?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    requests.push({ url, options });
    if (url === "/api/v2/tasks/7/interviews") return jsonResponse(rows);
    if (url === "/api/v2/interviews/9") return jsonResponse(sessionFixture());
    return handler(url, options);
  });
  const view = render(<InterviewWorkspace taskId={7} reportReady onChanged={vi.fn()} />);
  await screen.findByRole("heading", { name: "接口如何实现？", level: 2 });
  fireEvent.click(screen.getByText("历史面试 · 4 轮"));
  return { ...view, requests };
}
beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test.each(["network", "server", "invalid-json", "wrong-task", "wrong-session"])("历史读取失败（%s）保留当前会话与同一个输入框、草稿，重试只读取原选中会话", async (mode) => {
  let count = 0;
  const { requests } = await open(() => {
    if (++count > 1) return jsonResponse(historical(8));
    if (mode === "network") throw new Error("offline");
    if (mode === "server") return new Response(null, { status: 503 });
    if (mode === "invalid-json") return new Response("truncated");
    return jsonResponse(mode === "wrong-task" ? sessionFixture({ id: 8, task_id: 99 }) : historical(6));
  });
  const input = screen.getByLabelText("当前回答");
  fireEvent.change(input, { target: { value: "尚未提交的路由实现草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "继续面试 #8" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未能打开会话 #8");
  expect(screen.getByRole("heading", { name: "接口如何实现？", level: 2 })).toBeInTheDocument();
  expect(screen.getByLabelText("当前回答")).toBe(input);
  expect(input).toHaveValue("尚未提交的路由实现草稿");
  expect(sessionStorage.getItem("interview-draft:7:9:1")).toBe("尚未提交的路由实现草稿");
  fireEvent.click(screen.getByRole("button", { name: "重试打开会话 #8" }));
  expect(await screen.findByRole("heading", { name: "历史会话8的问题", level: 2 })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(requests.map(item => item.url)).toEqual(["/api/v2/tasks/7/interviews", "/api/v2/interviews/9", "/api/v2/interviews/8", "/api/v2/interviews/8"]);
  expect(requests.every(item => !item.options?.method || item.options.method === "GET")).toBe(true);
  expect(sessionStorage.getItem("interview-draft:7:9:1")).toBe("尚未提交的路由实现草稿");
});

test("读取在途保留当前作答与历史入口，后选中的会话不被旧响应覆盖", async () => {
  const older = deferred(); let olderSignal: AbortSignal | undefined;
  await open((url, options) => {
    if (url === "/api/v2/interviews/8") { olderSignal = options?.signal ?? undefined; return older.promise; }
    return jsonResponse(historical(6));
  });
  const input = screen.getByLabelText("当前回答");
  fireEvent.change(input, { target: { value: "保留草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "继续面试 #8" }));
  expect(screen.getByLabelText("当前回答")).toBe(input);
  expect(screen.getByRole("status")).toHaveTextContent("正在打开会话 #8");
  fireEvent.click(screen.getByRole("button", { name: "继续面试 #6" }));
  await screen.findByRole("heading", { name: "历史会话6的问题", level: 2 });
  expect(olderSignal?.aborted).toBe(true);
  await act(async () => older.resolve(jsonResponse(historical(8))));
  expect(screen.getByRole("heading", { name: "历史会话6的问题", level: 2 })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "历史会话8的问题", level: 2 })).not.toBeInTheDocument();
});

test("被后续选择取代的请求即使迟到失败，也不显示错误或清除新请求状态", async () => {
  const older = deferred(); const newer = deferred();
  await open(url => url.endsWith("/8") ? older.promise : newer.promise);
  fireEvent.click(screen.getByRole("button", { name: "继续面试 #8" }));
  fireEvent.click(screen.getByRole("button", { name: "继续面试 #6" }));
  await act(async () => older.reject(new Error("old request failed")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("正在打开会话 #6");
  await act(async () => newer.resolve(jsonResponse(historical(6))));
  expect(screen.getByRole("heading", { name: "历史会话6的问题", level: 2 })).toBeInTheDocument();
});

test("旧版与新版的相同会话编号不混用，旧版迟到不能覆盖新版选择", async () => {
  const old = deferred();
  await open(url => url === "/api/interviews/8" ? old.promise : jsonResponse(historical(8)));
  fireEvent.click(screen.getByRole("button", { name: "查看旧版模板面试 #8" }));
  fireEvent.click(screen.getByRole("button", { name: "继续面试 #8" }));
  await screen.findByRole("heading", { name: "历史会话8的问题", level: 2 });
  await act(async () => old.resolve(jsonResponse({ session: { id: 8, task_id: 7 }, turns: [{ id: 1, question: "旧版问题", answer: null }], review: null })));
  expect(screen.queryByRole("heading", { name: "旧版模板面试" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "历史会话8的问题", level: 2 })).toBeInTheDocument();
});

test("旧版历史读取失败可重试原旧版入口，并保留当前草稿", async () => {
  let count = 0;
  const { requests } = await open(() => ++count === 1 ? new Response(null, { status: 404 }) : jsonResponse({ session: { id: 8, task_id: 7 }, turns: [{ id: 1, question: "旧版问题", answer: null }], review: null }));
  fireEvent.change(screen.getByLabelText("当前回答"), { target: { value: "当前草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "查看旧版模板面试 #8" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("当前回答")).toHaveValue("当前草稿");
  fireEvent.click(screen.getByRole("button", { name: "重试打开会话 #8" }));
  expect(await screen.findByRole("heading", { name: "旧版模板面试" })).toBeInTheDocument();
  expect(requests.slice(-2).map(item => item.url)).toEqual(["/api/interviews/8", "/api/interviews/8"]);
  fireEvent.click(screen.getByRole("button", { name: "返回新版面试" }));
  expect(screen.getByLabelText("当前回答")).toHaveValue("当前草稿");
});

test("旧版返回同任务的另一会话时不能作为选中历史展示", async () => {
  await open(() => jsonResponse({ session: { id: 6, task_id: 7 }, turns: [{ id: 1, question: "不应展示的旧题", answer: null }], review: null }));
  fireEvent.click(screen.getByRole("button", { name: "查看旧版模板面试 #8" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未能打开会话 #8");
  expect(screen.getByRole("heading", { name: "接口如何实现？", level: 2 })).toBeInTheDocument();
  expect(screen.queryByText("不应展示的旧题")).not.toBeInTheDocument();
});

test("重复点击同一在途历史入口不重复读取", async () => {
  const response = deferred();
  const { requests } = await open(() => response.promise);
  const button = screen.getByRole("button", { name: "继续面试 #8" });
  fireEvent.click(button); fireEvent.click(button);
  expect(requests.filter(item => item.url === "/api/v2/interviews/8")).toHaveLength(1);
  await act(async () => response.resolve(jsonResponse(historical(8))));
  await screen.findByRole("heading", { name: "历史会话8的问题", level: 2 });
});

test("当前会话刷新成功后不被先前历史请求覆盖", async () => {
  const old = deferred();
  await open(() => old.promise);
  fireEvent.click(screen.getByRole("button", { name: "继续面试 #8" }));
  fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新状态" })).toBeEnabled());
  await act(async () => old.resolve(jsonResponse(historical(8))));
  expect(screen.getByRole("heading", { name: "接口如何实现？", level: 2 })).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("切换任务会取消历史读取，旧任务迟到响应不覆盖新任务", async () => {
  const old = deferred(); let signal: AbortSignal | undefined;
  const { rerender } = await open((url, options) => {
    if (url === "/api/v2/interviews/8") { signal = options?.signal ?? undefined; return old.promise; }
    if (url === "/api/v2/tasks/99/interviews") return jsonResponse([{ ...rows[0], id: 99, task_id: 99 }]);
    return jsonResponse(sessionFixture({ id: 99, task_id: 99, turns: [{ ...sessionFixture().turns[0], question: "另一任务的问题" }] }));
  });
  fireEvent.click(screen.getByRole("button", { name: "继续面试 #8" }));
  rerender(<InterviewWorkspace taskId={99} reportReady onChanged={vi.fn()} />);
  await screen.findByRole("heading", { name: "另一任务的问题", level: 2 });
  expect(signal?.aborted).toBe(true);
  await act(async () => old.resolve(jsonResponse(historical(8))));
  expect(screen.getByRole("heading", { name: "另一任务的问题", level: 2 })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("查看旧版记录时打开另一历史失败，仍保留旧版内容及返回入口", async () => {
  await open(url => url === "/api/interviews/8"
    ? jsonResponse({ session: { id: 8, task_id: 7 }, turns: [{ id: 1, question: "已打开的旧版问题", answer: "旧回答" }], review: null })
    : new Response(null, { status: 503 }));
  fireEvent.click(screen.getByRole("button", { name: "查看旧版模板面试 #8" }));
  await screen.findByText("已打开的旧版问题");
  fireEvent.click(screen.getByRole("button", { name: "继续面试 #6" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未能打开会话 #6");
  expect(screen.getByText("已打开的旧版问题")).toBeInTheDocument();
  expect(screen.getByText("旧回答")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "返回新版面试" }));
  expect(screen.getByRole("heading", { name: "接口如何实现？", level: 2 })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("当前已保存复盘不会因另一历史读取失败消失", async () => {
  const review = { overall_summary: "已保存的虚构复盘结论", summary: { answered_count: 1, unanswered_count: 0, question_count: 2, partial: true, covered_claim_ids: [2], uncovered_claims: [], context_truncated: false },
    turns: [], turn_reviews: [], consistency: [], omissions: [], technical_gaps: [], next_steps: [], evidence: [], notice: "虚构练习记录" };
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/api/v2/tasks/7/interviews") return jsonResponse(rows.map(item => ({ ...item, status: "completed" })));
    if (url === "/api/v2/interviews/9") return jsonResponse(sessionFixture({ status: "completed", review }));
    return new Response(null, { status: 503 });
  });
  render(<InterviewWorkspace taskId={7} reportReady onChanged={vi.fn()} />);
  await screen.findByText("已保存的虚构复盘结论");
  fireEvent.click(screen.getByText("历史面试 · 4 轮"));
  fireEvent.click(screen.getByRole("button", { name: "查看复盘 #8" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未能打开会话 #8");
  expect(screen.getByText("已保存的虚构复盘结论")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导出复盘" })).toBeEnabled();
});

test.each([1, 2])("首次自动恢复失败后能通过历史入口成功打开版本%s，不被旧错误遮挡", async (version) => {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/api/v2/tasks/7/interviews") return jsonResponse(rows);
    if (url === "/api/v2/interviews/9") return new Response(null, { status: 503 });
    if (url === "/api/interviews/8") return jsonResponse({ session: { id: 8, task_id: 7 }, turns: [{ id: 1, question: "通过旧版历史恢复", answer: null }], review: null });
    return jsonResponse(historical(8));
  });
  render(<InterviewWorkspace taskId={7} reportReady onChanged={vi.fn()} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByText("历史面试 · 4 轮"));
  fireEvent.click(screen.getByRole("button", { name: version === 1 ? "查看旧版模板面试 #8" : "继续面试 #8" }));
  if (version === 1) expect(await screen.findByText("通过旧版历史恢复")).toBeInTheDocument();
  else expect(await screen.findByRole("heading", { name: "历史会话8的问题", level: 2 })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
