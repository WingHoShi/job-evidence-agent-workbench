import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MaterialsPage } from "./MaterialsPage";
import { TaskWorkspace } from "../workbench/TaskWorkspace";

const resume = [{ id: 1, kind: "resume", label: "示例简历", relative_path: "resume.md" }];
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

test("只有项目材料时不能提取，并提示先导入简历", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<MaterialsPage taskId={7} sources={[{ ...resume[0], kind: "project" }]} onChanged={vi.fn()} />);
  expect(screen.getByRole("button", { name: "提取能力主张" })).toBeDisabled();
  expect(screen.getByText(/请先导入简历/)).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test("工作台已有主张时引导继续审核，不发送提取请求", async () => {
  const snapshot = { id: 7, name: "虚构任务", status: "draft", sources: resume,
    claims: [{ id: 3, text: "使用 Python。", resume_locator: "line:1", capability_tags: [], status: "pending_review" }],
    assessments: {}, gates: {}, report_ready: false, audit: { status: "created", claim_id: null, events: [], recoverable: false } };
  const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify(snapshot))); vi.stubGlobal("fetch", fetch);
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "材料中心" }));
  expect(screen.queryByRole("button", { name: "提取能力主张" })).not.toBeInTheDocument();
  expect(screen.getByText(/已有 1 条能力主张/)).toBeInTheDocument();
  expect(screen.getByText(/新建任务/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "继续审核" }));
  expect(await screen.findByRole("heading", { name: "证据审计" })).toBeInTheDocument();
  expect(fetch.mock.calls.every((args) => !String(args[0]).includes("claims/generate"))).toBe(true);
});

test("提取已确认但刷新失败时保留主张数量，只刷新状态再进入审核", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1 }])));
  vi.stubGlobal("fetch", fetch);
  const onChanged = vi.fn().mockRejectedValueOnce(new Error("refresh failed")).mockResolvedValue(undefined);
  const onReview = vi.fn();
  render(<MaterialsPage taskId={7} sources={resume} onChanged={onChanged} onReview={onReview} />);
  fireEvent.click(screen.getByRole("button", { name: "提取能力主张" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("主张已提取，但列表刷新失败");
  expect(screen.getByText(/已有 1 条能力主张/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "提取能力主张" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "继续审核" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "刷新材料列表" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "继续审核" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "继续审核" }));
  expect(fetch).toHaveBeenCalledOnce(); expect(onChanged).toHaveBeenCalledTimes(2); expect(onReview).toHaveBeenCalledOnce();
});

test.each(["network", "http", "empty", "shape"])("提取结果不确定（%s）时提示先核对，不虚报已提取零条", async (mode) => {
  const fetch = vi.fn(async () => {
    if (mode === "network") throw new Error("offline");
    if (mode === "http") return new Response("internal", { status: 500 });
    return new Response(JSON.stringify(mode === "empty" ? [] : [{ id: "invalid" }]));
  }); vi.stubGlobal("fetch", fetch); const onChanged = vi.fn();
  render(<MaterialsPage taskId={7} sources={resume} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "提取能力主张" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未能确认主张提取结果");
  expect(screen.queryByText(/已提取 0 条/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "刷新材料列表" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce()); expect(fetch).toHaveBeenCalledOnce();
});

test("成功提取但刷新失败后切页再返回，仍保留主张与刷新入口", async () => {
  const claims = [{ id: 1, text: "使用 Python。", resume_locator: "line:1", capability_tags: [], status: "pending_review" }];
  const snapshot = { id: 7, name: "虚构任务", status: "draft", sources: resume, claims: [], assessments: {}, gates: {}, report_ready: false, audit: { status: "created", claim_id: null, events: [], recoverable: false } };
  let extracted = false; let refreshFails = true;
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("claims/generate")) { extracted = true; return new Response(JSON.stringify(claims)); }
    if (extracted && refreshFails) return new Response(null, { status: 503 });
    return new Response(JSON.stringify({ ...snapshot, claims: extracted ? claims : [] }));
  }); vi.stubGlobal("fetch", fetch);
  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "材料中心" }));
  fireEvent.click(screen.getByRole("button", { name: "提取能力主张" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "任务概览" }));
  fireEvent.click(screen.getByRole("button", { name: "材料中心" }));
  expect(screen.queryByRole("button", { name: "提取能力主张" })).not.toBeInTheDocument();
  expect(screen.getByText(/已有 1 条能力主张/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "继续审核" })).toBeDisabled();
  refreshFails = false;
  fireEvent.click(screen.getByRole("button", { name: "刷新材料列表" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "继续审核" })).toBeEnabled());
  expect(fetch.mock.calls.filter((args) => args[1]?.method === "POST")).toHaveLength(1);
});
