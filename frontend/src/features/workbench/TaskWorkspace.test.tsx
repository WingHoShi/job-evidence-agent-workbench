import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { TaskWorkspace } from "./TaskWorkspace";
import { sessionFixture } from "../interview/interviewFixtures.test-utils";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const savedTask = {
  id: 9, name: "后端工程师岗位", status: "draft", sources: [], claims: [],
  assessments: {}, gates: {}, report_ready: false,
  audit: { status: "created", claim_id: null, events: [], recoverable: false },
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

test("侧栏按 ID 区分同名任务，切换后恢复选中任务且不写业务数据", async () => {
  const writes: string[] = [];
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (options?.method && options.method !== "GET") writes.push(url);
    if (url === "/api/tasks") return Promise.resolve(jsonResponse([{ id: 9, name: savedTask.name, status: "draft" }, { id: 4, name: savedTask.name, status: "draft" }]));
    return Promise.resolve(jsonResponse({ ...savedTask, id: Number(url.split("/").pop()) }));
  }));
  sessionStorage.setItem("interview-draft:9:2:1", "未提交草稿");
  const view = render(<TaskWorkspace initialTaskId={9} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
  fireEvent.change(await screen.findByLabelText("选择任务"), { target: { value: "4" } });
  await waitFor(() => expect(localStorage.getItem("job-evidence.active-task-id")).toBe("4"));
  expect(await screen.findByText(/当前任务 #4/)).toBeInTheDocument();
  expect(sessionStorage.getItem("interview-draft:9:2:1")).toBe("未提交草稿");
  expect(writes).toEqual([]);
  view.unmount();
  render(<TaskWorkspace />);
  expect(await screen.findByText(/当前任务 #4/)).toBeInTheDocument();
});

test("创建任务后刷新工作台仍能恢复同一任务", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) =>
    Promise.resolve(jsonResponse(url === "/api/tasks" ? { id: 9 } : savedTask)),
  ));
  const firstVisit = render(<TaskWorkspace />);
  fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: savedTask.name } });
  fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
  await screen.findByRole("heading", { name: "材料中心" });
  firstVisit.unmount();

  render(<TaskWorkspace />);

  expect(await screen.findByRole("heading", { name: "任务概览" })).toBeInTheDocument();
  expect(screen.getByText(savedTask.name)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "新建求职任务" })).not.toBeInTheDocument();
});

test("任务列表失败不切换任务，重试仍能读取列表", async () => {
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url !== "/api/tasks") return Promise.resolve(jsonResponse(savedTask));
    return Promise.resolve(++attempts === 1 ? jsonResponse({}, false) : jsonResponse([savedTask]));
  }));
  render(<TaskWorkspace initialTaskId={9} />);
  await screen.findByText("当前任务 #9");
  fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("当前任务未改变");
  expect(localStorage.getItem("job-evidence.active-task-id")).toBe("9");
  fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
  expect(await screen.findByLabelText("选择任务")).toBeInTheDocument();
});

test("实际输入面试草稿后切换任务再返回，回答恢复且审核状态不变", async () => {
  const writes: string[] = [];
  const session = sessionFixture({ task_id: 9 });
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (options?.method && options.method !== "GET") writes.push(url);
    const body = url === "/api/tasks" ? [savedTask, { ...savedTask, id: 4 }] :
      url === "/api/v2/tasks/9/interviews" ? [{ id: session.id, task_id: 9, version: 2, status: session.status, question_count: 2 }] :
      url === `/api/v2/interviews/${session.id}` ? session :
      { ...savedTask, id: Number(url.split("/").pop()), report_ready: true, audit: { ...savedTask.audit, status: "completed" } };
    return Promise.resolve(jsonResponse(body));
  }));
  render(<TaskWorkspace initialTaskId={9} />);
  await screen.findByText("当前任务 #9");
  fireEvent.click(screen.getByRole("button", { name: "模拟面试" }));
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: "我的未提交面试草稿" } });
  for (const id of [4, 9]) {
    fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
    fireEvent.change(await screen.findByLabelText("选择任务"), { target: { value: String(id) } });
    await screen.findByText(`当前任务 #${id}`);
  }
  fireEvent.click(screen.getByRole("button", { name: "模拟面试" }));
  expect(await screen.findByRole("textbox")).toHaveValue("我的未提交面试草稿");
  expect(screen.getByRole("button", { name: "审计报告" })).toBeEnabled();
  expect(writes).toEqual([]);
});

test("选中任务读取失败后仍可切回原任务", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(
    url === "/api/tasks" ? jsonResponse([savedTask, { ...savedTask, id: 4 }]) :
    url === "/api/tasks/4" ? jsonResponse({}, false) : jsonResponse(savedTask),
  )));
  render(<TaskWorkspace initialTaskId={9} />);
  await screen.findByText("当前任务 #9");
  fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
  fireEvent.change(await screen.findByLabelText("选择任务"), { target: { value: "4" } });
  await screen.findByRole("heading", { name: "恢复求职任务" });
  fireEvent.click(screen.getByRole("button", { name: "切换任务" }));
  fireEvent.change(await screen.findByLabelText("选择任务"), { target: { value: "9" } });
  expect(await screen.findByRole("heading", { name: "任务概览" })).toBeInTheDocument();
});

test("读取失败后可以重试恢复已有任务", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockRejectedValueOnce(new Error("network unavailable"))
    .mockResolvedValueOnce(jsonResponse(savedTask)));
  render(<TaskWorkspace initialTaskId={9} />);
  await screen.findByRole("alert");

  fireEvent.click(screen.getByRole("button", { name: "重试读取任务" }));

  expect(await screen.findByRole("heading", { name: "任务概览" })).toBeInTheDocument();
  expect(screen.getByText(savedTask.name)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("创建失败后保留任务名称并允许重新提交", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(jsonResponse({}, false))
    .mockResolvedValueOnce(jsonResponse({ id: 9 }))
    .mockResolvedValueOnce(jsonResponse(savedTask)));
  render(<TaskWorkspace />);
  fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: savedTask.name } });
  fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
  await screen.findByRole("alert");

  expect(screen.getByLabelText("任务名称")).toHaveValue(savedTask.name);
  expect(screen.getByRole("button", { name: "创建任务" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "创建任务" }));

  expect(await screen.findByRole("heading", { name: "材料中心" })).toBeInTheDocument();
});

test("任务已创建但读取失败时刷新不会重复创建任务", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(jsonResponse({ id: 9 }))
    .mockRejectedValueOnce(new Error("network unavailable")));
  const firstVisit = render(<TaskWorkspace />);
  fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: savedTask.name } });
  fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
  await screen.findByRole("alert");
  firstVisit.unmount();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(savedTask)));

  render(<TaskWorkspace />);

  expect(await screen.findByRole("heading", { name: "任务概览" })).toBeInTheDocument();
  expect(screen.getByText(savedTask.name)).toBeInTheDocument();
});

test("读取已有任务快照后展示概览和继续审核操作", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 7,
        name: "AI 应用开发岗位",
        status: "draft",
        sources: [{ id: 1, kind: "resume", label: "简历", relative_path: "pasted/简历.txt" }],
        claims: [
          { id: 1, text: "使用 FastAPI 提供服务", resume_locator: "简历:1", capability_tags: ["后端"], status: "confirmed" },
          { id: 2, text: "掌握 Docker", resume_locator: "简历:2", capability_tags: ["工程化"], status: "pending_review" },
        ],
        assessments: {},
        gates: {},
        audit: { status: "awaiting_review", claim_id: 2, events: [], recoverable: true },
      }),
    }),
  );

  render(<TaskWorkspace initialTaskId={7} />);

  expect(await screen.findByRole("heading", { name: "任务概览" })).toBeInTheDocument();
  expect(screen.getByText("1 / 2 条已审核")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "继续审核" })).toBeInTheDocument();
});

test("导航到材料中心后展示任务材料", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 7,
        name: "AI 应用开发岗位",
        status: "draft",
        sources: [{ id: 1, kind: "resume", label: "简历", relative_path: "pasted/简历.txt" }],
        claims: [], assessments: {}, gates: {},
        audit: { status: "created", claim_id: null, events: [], recoverable: false },
      }),
    }),
  );

  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "材料中心" }));

  expect(screen.getByRole("heading", { name: "材料中心" })).toBeInTheDocument();
  expect(screen.getAllByText("简历")).toHaveLength(2);
});

test("导航到证据审计后展示逐条审核工作区", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: 7, name: "AI 应用开发岗位", status: "draft", sources: [],
      claims: [{ id: 1, text: "熟悉 FastAPI", resume_locator: "简历:1", capability_tags: [], status: "pending_review" }],
      assessments: {}, gates: {},
      audit: { status: "awaiting_review", claim_id: 1, events: [], recoverable: true },
    }),
  }));

  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "证据审计" }));

  expect(screen.getByRole("heading", { name: "证据审计" })).toBeInTheDocument();
});

test("完成审核并已有报告后解锁报告和模拟面试", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: 7, name: "AI 应用开发岗位", status: "draft", sources: [], claims: [], assessments: {}, gates: {}, report_ready: true,
      audit: { status: "completed", claim_id: null, events: [], recoverable: false },
    }),
  }));

  render(<TaskWorkspace initialTaskId={7} />);
  await screen.findByRole("heading", { name: "任务概览" });
  fireEvent.click(screen.getByRole("button", { name: "审计报告" }));
  expect(screen.getByRole("heading", { name: "审计报告" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "模拟面试" }));
  expect(screen.getByRole("heading", { name: "模拟面试" })).toBeInTheDocument();
});

test("没有当前任务时创建任务并进入材料中心", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve({
    ok: true,
    json: async () => url === "/api/tasks"
      ? ({ id: 9, name: "后端工程师岗位", status: "draft" })
      : ({
          id: 9,
          name: "后端工程师岗位",
          status: "draft",
          sources: [],
          claims: [],
          assessments: {},
          gates: {},
          audit: { status: "created", claim_id: null, events: [], recoverable: false },
        }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  render(<TaskWorkspace />);
  fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "后端工程师岗位" } });
  fireEvent.click(screen.getByRole("button", { name: "创建任务" }));

  expect(await screen.findByRole("heading", { name: "材料中心" })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/tasks", expect.objectContaining({ method: "POST" }));
});
