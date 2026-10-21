import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuditWorkspacePage } from "./AuditWorkspacePage";
import { TaskWorkspace } from "../workbench/TaskWorkspace";
import { TaskSnapshot } from "../workbench/types";

const snapshot: TaskSnapshot = {
  id: 7, name: "虚构审核恢复任务", status: "draft", sources: [],
  claims: [{ id: 1, text: "使用 Python 提供服务", resume_locator: "line:1", capability_tags: [], status: "pending_review" }],
  assessments: { "1": { claim_id: 1, verdict: "strong", links: [11], rationale: "虚构材料支持" } },
  gates: { "1": { eligible: true, requires_review: false, reason: "虚构门禁" } }, report_ready: false,
  audit: { status: "awaiting_review", claim_id: 1, events: [], recoverable: true },
};
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const actions = [
  { name: "接受", button: "接受主张", saved: "审核结果已保存", endpoint: "/audit/review" },
  { name: "拒绝", button: "拒绝主张", confirm: "确认拒绝", saved: "审核结果已保存", endpoint: "/audit/review" },
  { name: "补证", button: "补充证据", saved: "补充证据已保存", endpoint: "/audit/review" },
  { name: "撤销", button: "撤销审核，返回待审核", confirm: "确认撤销", saved: "已撤销审核，返回待审核", endpoint: "/claims/1/undo-review" },
  { name: "开始", button: "开始逐条审核", saved: "已开始逐条审核", endpoint: "/audit/start" },
  { name: "判定", button: "重新判定当前主张", saved: "候选证据判定已完成", endpoint: "/claims/1/assessment" },
];

test.each(actions)("$name成功但刷新失败时只刷新，不重复业务请求", async (action) => {
  const writes: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    writes.push(url);
    return new Response(JSON.stringify(action.name === "判定"
      ? { assessment: snapshot.assessments["1"], gate: snapshot.gates["1"], evidence: [] }
      : { status: "awaiting_review", claim_id: 1, events: [] }));
  });
  const onChanged = vi.fn().mockRejectedValueOnce(new Error("snapshot unavailable")).mockResolvedValue(undefined);
  const state = action.name === "撤销" ? { ...snapshot, claims: [{ ...snapshot.claims[0], status: "confirmed" }] }
    : action.name === "开始" ? { ...snapshot, audit: { ...snapshot.audit, status: "created", claim_id: null } } : snapshot;
  render(<AuditWorkspacePage snapshot={state} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: action.button }));
  if (action.confirm) fireEvent.click(screen.getByRole("button", { name: action.confirm }));
  if (action.name === "补证") {
    fireEvent.change(screen.getByRole("textbox", { name: "补充说明" }), { target: { value: "虚构运行记录" } });
    fireEvent.click(screen.getByRole("button", { name: "保存补充证据" }));
  }
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(action.saved);
  expect(alert).toHaveTextContent("刷新");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const buttonAfter = action.name === "补证" ? "收起补充证据" : action.button;
  expect(screen.getByRole("button", { name: buttonAfter })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "刷新审核状态" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: buttonAfter })).toBeEnabled();
  expect(writes).toEqual([`/api/tasks/7${action.endpoint}`]);
});

test.each(["network", "server", "malformed", "empty-object", "wrong-shape"])("%s结果未知时先核对状态，不误称提交失败", async (mode) => {
  let writes = 0;
  vi.stubGlobal("fetch", async () => {
    writes++;
    if (mode === "network") throw new Error("connection lost");
    if (mode === "empty-object") return new Response("{}");
    if (mode === "wrong-shape") return new Response(JSON.stringify({ status: "awaiting_review", claim_id: "wrong", events: [] }));
    return mode === "server" ? new Response("internal", { status: 500 }) : new Response("truncated");
  });
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "接受主张" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("尚未确认");
  expect(screen.getByRole("button", { name: "接受主张" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "刷新审核状态" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "接受主张" })).toBeEnabled());
  expect(writes).toBe(1);
});

test("合法JSON但判定字段错误时不保存为成功，也不渲染错误原文数组", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ evidence: "bad", assessment: snapshot.assessments["1"], gate: snapshot.gates["1"] })));
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "重新判定当前主张" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("尚未确认");
  expect(screen.getByRole("button", { name: "重新判定当前主张" })).toBeDisabled();
});

test("刷新返回不完整任务对象时保留原页面与恢复锁", async () => {
  let saved = false;
  vi.stubGlobal("fetch", async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") { saved = true; return new Response(JSON.stringify({ status: "completed", claim_id: null, events: [] })); }
    return new Response(JSON.stringify(saved ? { id: 7 } : snapshot));
  });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  fireEvent.click(screen.getByRole("button", { name: "接受主张" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("heading", { name: "证据审计" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "刷新审核状态" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新审核状态" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "接受主张" })).toBeDisabled();
});

test("旧实例自动刷新晚到不能解锁后续正在提交的操作", async () => {
  let completeOldGet!: (response: Response) => void;
  let completeNewPost!: (response: Response) => void;
  let writes = 0; let readsAfterWrite = 0;
  const result = { status: "awaiting_review", claim_id: 1, events: [] };
  vi.stubGlobal("fetch", async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      writes++;
      return writes === 1 ? new Response(JSON.stringify(result)) : new Promise<Response>((resolve) => { completeNewPost = resolve; });
    }
    if (writes && ++readsAfterWrite === 1) return new Promise<Response>((resolve) => { completeOldGet = resolve; });
    return new Response(JSON.stringify(snapshot));
  });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  fireEvent.click(screen.getByRole("button", { name: "接受主张" }));
  await waitFor(() => expect(completeOldGet).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "任务概览" }));
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  fireEvent.click(screen.getByRole("button", { name: "刷新审核状态" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "接受主张" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "接受主张" }));
  completeOldGet(new Response(JSON.stringify(snapshot)));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("正在"));
  fireEvent.click(screen.getByRole("button", { name: "任务概览" }));
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  expect(screen.getByRole("button", { name: "接受主张" })).toBeDisabled();
  expect(writes).toBe(2);
  completeNewPost(new Response(JSON.stringify(result)));
  await waitFor(() => expect(screen.getByRole("button", { name: "接受主张" })).toBeEnabled());
});

test("明确被拒绝的请求保留服务端提示和重试入口", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: "请先确认风险" }), { status: 409 }));
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "接受主张" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("请先确认风险");
  expect(screen.getByRole("button", { name: "接受主张" })).toBeEnabled();
});

test("工作台切页返回保留待刷新状态，刷新GET后显示后端真实审核结果", async () => {
  let saved = false; let failRefresh = true; const writes: string[] = [];
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      writes.push(url); saved = true;
      return new Response(JSON.stringify({ status: "completed", claim_id: null, events: [] }));
    }
    if (saved && failRefresh) return new Response(null, { status: 503 });
    return new Response(JSON.stringify(saved ? { ...snapshot, claims: [{ ...snapshot.claims[0], status: "confirmed" }], audit: { ...snapshot.audit, status: "completed", claim_id: null } } : snapshot));
  });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  fireEvent.click(screen.getByRole("button", { name: "接受主张" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "任务概览" }));
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  expect(screen.getByRole("alert")).toHaveTextContent("审核结果已保存");
  expect(screen.getByRole("button", { name: "接受主张" })).toBeDisabled();
  failRefresh = false;
  fireEvent.click(screen.getByRole("button", { name: "刷新审核状态" }));
  expect(await screen.findByText("已接受")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(writes).toEqual(["/api/tasks/7/audit/review"]);
});

test("请求尚在进行时切页返回仍锁定写入，不允许并行重复提交", async () => {
  let complete!: (response: Response) => void; let writes = 0;
  vi.stubGlobal("fetch", async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") { writes++; return new Promise<Response>((resolve) => { complete = resolve; }); }
    return new Response(JSON.stringify(snapshot));
  });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  fireEvent.click(screen.getByRole("button", { name: "接受主张" }));
  fireEvent.click(screen.getByRole("button", { name: "任务概览" }));
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  expect(screen.getByRole("button", { name: "接受主张" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("正在");
  fireEvent.click(screen.getByRole("button", { name: "接受主张" }));
  expect(writes).toBe(1);
  complete(new Response(JSON.stringify({ status: "completed", claim_id: null, events: [] })));
  await waitFor(() => expect(screen.getByRole("button", { name: "接受主张" })).toBeEnabled());
});

test("结果未知且多次刷新失败时保留补证草稿，只GET重试不重复补证", async () => {
  let writes = 0;
  vi.stubGlobal("fetch", async () => { writes++; throw new Error("lost response"); });
  const onChanged = vi.fn().mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "补充证据" }));
  fireEvent.change(screen.getByRole("textbox", { name: "补充说明" }), { target: { value: "不确定是否保存的虚构说明" } });
  fireEvent.click(screen.getByRole("button", { name: "保存补充证据" }));
  await screen.findByRole("alert");
  for (let attempt = 0; attempt < 2; attempt++) {
    fireEvent.click(screen.getByRole("button", { name: "刷新审核状态" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新审核状态" })).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("尚未确认");
    expect(screen.getByRole("button", { name: "接受主张" })).toBeDisabled();
  }
  expect(screen.getByRole("textbox", { name: "补充说明" })).toHaveValue("不确定是否保存的虚构说明");
  fireEvent.click(screen.getByRole("button", { name: "刷新审核状态" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "接受主张" })).toBeEnabled());
  expect(writes).toBe(1); expect(onChanged).toHaveBeenCalledTimes(3);
});

test("切换任务时待确认锁不串任务，返回原任务需真实读取成功才能解除", async () => {
  let uncertain = false; const writes: string[] = [];
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") { writes.push(url); uncertain = true; throw new Error("unknown outcome"); }
    if (url === "/api/tasks") return new Response(JSON.stringify([{ id: 7, name: "任务甲", status: "draft" }, { id: 8, name: "任务乙", status: "draft" }]));
    const id = Number(url.split("/").pop());
    if (id === 7 && uncertain) return new Response(null, { status: 503 });
    return new Response(JSON.stringify({ ...snapshot, id, name: id === 7 ? "任务甲" : "任务乙" }));
  });
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  fireEvent.click(screen.getByRole("button", { name: "接受主张" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
  fireEvent.change(await screen.findByLabelText("选择任务"), { target: { value: "8" } });
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "接受主张" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
  fireEvent.change(await screen.findByLabelText("选择任务"), { target: { value: "7" } });
  expect(await screen.findByRole("heading", { name: "恢复求职任务" })).toBeInTheDocument();
  uncertain = false;
  fireEvent.click(screen.getByRole("button", { name: "重试读取任务" }));
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "接受主张" })).toBeEnabled();
  expect(writes).toEqual(["/api/tasks/7/audit/review"]);
});
