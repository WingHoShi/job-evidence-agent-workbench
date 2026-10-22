import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ReportWorkspacePage } from "./ReportWorkspacePage";
import { TaskWorkspace } from "../workbench/TaskWorkspace";
import { reportFixture } from "./reportFixtures.test-utils";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
const json = (body: unknown) => new Response(JSON.stringify(body));
const snapshot = (id = 7) => ({ id, name: `虚构任务${id}`, status: "draft", sources: [],
  claims: [{ id: 1, text: "虚构接口实现", resume_locator: "line:1", capability_tags: [], status: "confirmed" }],
  assessments: {}, gates: {}, report_ready: true, audit: { status: "completed", claim_id: null, events: [], recoverable: false } });

test("报告已取得但任务刷新失败时保留内容，重试只刷新任务状态", async () => {
  const fetch = vi.fn(async () => json(reportFixture())); vi.stubGlobal("fetch", fetch);
  const onGenerated = vi.fn().mockRejectedValueOnce(new Error("snapshot failed")).mockResolvedValue(undefined);
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" onGenerated={onGenerated} />);
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("报告已取得");
  expect(screen.getByRole("heading", { name: "主张 1 · 虚构接口实现" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "刷新报告" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "刷新任务状态" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "刷新报告" })).toBeEnabled();
  expect(fetch).toHaveBeenCalledOnce(); expect(onGenerated).toHaveBeenCalledTimes(2);
});

test.each(["network", "server", "empty", "nested", "wrong-task"])("刷新失败（%s）保留上一版报告，不虚报新结果", async (mode) => {
  let count = 0;
  vi.stubGlobal("fetch", async () => {
    if (++count === 1) return json(reportFixture());
    if (mode === "network") throw new Error("offline");
    if (mode === "server") return new Response("internal", { status: 503 });
    if (mode === "empty") return json({});
    if (mode === "nested") return json({ ...reportFixture(), claim_reviews: [{ ...reportFixture().claim_reviews[0], evidence: "bad" }] });
    return json(reportFixture(8, "另一任务的报告"));
  });
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" onGenerated={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  await screen.findByRole("heading", { name: "主张 1 · 虚构接口实现" });
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新报告" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "刷新报告" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("仍显示上次取得的报告");
  expect(screen.getByRole("heading", { name: "主张 1 · 虚构接口实现" })).toBeInTheDocument();
  expect(screen.queryByText(/另一任务的报告/)).not.toBeInTheDocument();
});

test("首次遇到结构错误的报告时不渲染、不通知任务已生成", async () => {
  const onGenerated = vi.fn(); vi.stubGlobal("fetch", async () => json({ task_id: 7, claim_reviews: [] }));
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" onGenerated={onGenerated} />);
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未能取得有效报告");
  expect(screen.queryByRole("region", { name: "审核摘要" })).not.toBeInTheDocument();
  expect(onGenerated).not.toHaveBeenCalled();
});

test("报告切页返回仍可查看，不自动请求报告接口", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { requests.push(url); return json(url.endsWith("/report") ? reportFixture() : snapshot()); });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  await screen.findByRole("heading", { name: "主张 1 · 虚构接口实现" });
  fireEvent.click(screen.getByRole("button", { name: "任务概览" }));
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  expect(screen.getByRole("heading", { name: "主张 1 · 虚构接口实现" })).toBeInTheDocument();
  expect(requests.filter((url) => url.endsWith("/report"))).toHaveLength(1);
});

test("报告请求进行中切页返回仍阻止重复请求", async () => {
  let complete!: (response: Response) => void; let count = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/report")) { count++; return new Promise<Response>((resolve) => { complete = resolve; }); }
    return json(snapshot());
  });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  fireEvent.click(screen.getByRole("button", { name: "任务概览" }));
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  expect(screen.getByRole("button", { name: "正在生成…" })).toBeDisabled();
  expect(count).toBe(1);
  await act(async () => complete(json(reportFixture())));
  expect(await screen.findByRole("heading", { name: "主张 1 · 虚构接口实现" })).toBeInTheDocument();
});

test("不同任务报告不混用，切回原任务恢复原报告", async () => {
  const reports: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/api/tasks") return json([snapshot(7), snapshot(8)]);
    const id = Number(url.split("/")[3]);
    if (url.endsWith("/report")) { reports.push(url); return json(reportFixture(id, `任务${id}报告`)); }
    return json(snapshot(id));
  });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  await screen.findByRole("heading", { name: "主张 1 · 任务7报告" });
  for (const id of [8, 7]) {
    fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
    fireEvent.change(await screen.findByLabelText("选择任务"), { target: { value: String(id) } });
    await screen.findByRole("heading", { name: "任务概览" });
    fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
    if (id === 8) {
      expect(screen.queryByText(/任务7报告/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
      await screen.findByRole("heading", { name: "主张 1 · 任务8报告" });
    }
  }
  expect(screen.getByRole("heading", { name: "主张 1 · 任务7报告" })).toBeInTheDocument();
  expect(screen.queryByText(/任务8报告/)).not.toBeInTheDocument();
  expect(reports).toEqual(["/api/tasks/7/report", "/api/tasks/8/report"]);
});

test("切页后仍保留同步失败提示，连续重试仅读取任务接口", async () => {
  let generated = false; let allowSync = false; const requests: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    if (url.endsWith("/report")) { generated = true; return json(reportFixture()); }
    if (generated && !allowSync) return new Response(null, { status: 503 });
    return json({ ...snapshot(), report_ready: generated });
  });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "任务概览" }));
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  expect(screen.getByRole("alert")).toHaveTextContent("报告已取得");
  fireEvent.click(screen.getByRole("button", { name: "刷新任务状态" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "刷新报告" })).toBeDisabled();
  allowSync = true;
  fireEvent.click(screen.getByRole("button", { name: "刷新任务状态" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "模拟面试" })).toBeEnabled();
  expect(requests.filter((url) => url.endsWith("/report"))).toEqual(["/api/tasks/7/report"]);
  expect(requests.filter((url) => url.endsWith("/report.md"))).toHaveLength(0);
});

test("任务接口仍未确认报告就绪时保留同步提示，不误报已完成", async () => {
  vi.stubGlobal("fetch", async (url: string) => json(url.endsWith("/report") ? reportFixture() : { ...snapshot(), report_ready: false }));
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("报告已取得");
  expect(screen.getByRole("button", { name: "模拟面试" })).toBeDisabled();
  expect(screen.getByRole("heading", { name: "主张 1 · 虚构接口实现" })).toBeInTheDocument();
});

test("离开任务后报告请求才完成，不覆盖当前任务，并在切回时恢复", async () => {
  let complete!: (response: Response) => void; const requests: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    if (url === "/api/tasks") return json([snapshot(7), snapshot(8)]);
    if (url === "/api/tasks/7/report") return new Promise<Response>((resolve) => { complete = resolve; });
    return json(snapshot(Number(url.split("/")[3])));
  });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
  fireEvent.change(await screen.findByLabelText("选择任务"), { target: { value: "8" } });
  await screen.findByRole("heading", { name: "任务概览" });
  await act(async () => complete(json(reportFixture())));
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  expect(screen.queryByText(/虚构接口实现/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成审计报告" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
  fireEvent.change(await screen.findByLabelText("选择任务"), { target: { value: "7" } });
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  expect(screen.getByRole("heading", { name: "主张 1 · 虚构接口实现" })).toBeInTheDocument();
  expect(requests.filter((url) => url.endsWith("/report"))).toHaveLength(1);
});

test("同步任务GET在途时切页保留报告和锁，失败后只重试同步", async () => {
  let generated = false; let allowSync = false; let finishSync!: (response: Response) => void; let reports = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/report")) { generated = true; reports++; return json(reportFixture()); }
    if (generated && !allowSync) return new Promise<Response>((resolve) => { finishSync = resolve; });
    return json(snapshot());
  });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  await screen.findByRole("status");
  fireEvent.click(screen.getByRole("button", { name: "任务概览" }));
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  expect(screen.getByRole("heading", { name: "主张 1 · 虚构接口实现" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("正在同步任务状态");
  expect(screen.getByRole("button", { name: "刷新报告" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "刷新任务状态" })).not.toBeInTheDocument();
  await act(async () => finishSync(new Response(null, { status: 503 })));
  expect(await screen.findByRole("alert")).toHaveTextContent("报告已取得");
  allowSync = true;
  fireEvent.click(screen.getByRole("button", { name: "刷新任务状态" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(reports).toBe(1);
});
