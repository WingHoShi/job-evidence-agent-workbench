import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { MaterialsPage } from "./MaterialsPage";

test("导入文件后显示导入数量并通知任务刷新", async () => {
  const onChanged = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ imported_count: 1, skipped_paths: [], errors: [] }) }));

  render(<MaterialsPage taskId={7} sources={[]} onChanged={onChanged} />);
  const file = new File(["# 简历"], "resume.md", { type: "text/markdown" });
  fireEvent.change(screen.getByLabelText("批量选择文件"), { target: { files: [file] } });

  expect(await screen.findByText("已导入 1 个文件")).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledOnce();
});

test("导入粘贴材料失败时展示可理解的错误", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ detail: "材料内容无法导入" }),
  }));
  const onChanged = vi.fn();

  render(<MaterialsPage taskId={7} sources={[]} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
  fireEvent.change(screen.getByLabelText("材料名称"), { target: { value: "岗位描述" } });
  fireEvent.change(screen.getByLabelText("粘贴材料"), { target: { value: "负责 AI 应用开发" } });
  fireEvent.click(screen.getByRole("button", { name: "导入粘贴材料" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("材料内容无法导入");
  expect(onChanged).not.toHaveBeenCalled();
});

test("切换导入方式只展示当前入口并保留粘贴草稿与材料类型", () => {
  render(<MaterialsPage taskId={7} sources={[]} onChanged={vi.fn()} />);
  expect(screen.getByLabelText("批量选择文件")).toBeInTheDocument();
  expect(screen.queryByLabelText("材料名称")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("材料类型"), { target: { value: "resume" } });
  fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
  fireEvent.change(screen.getByLabelText("材料名称"), { target: { value: "我的简历" } });
  fireEvent.change(screen.getByLabelText("粘贴材料"), { target: { value: "保留这份草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "项目目录" }));
  expect(screen.queryByLabelText("粘贴材料")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "选择项目目录" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
  expect(screen.getByLabelText("材料名称")).toHaveValue("我的简历");
  expect(screen.getByLabelText("粘贴材料")).toHaveValue("保留这份草稿");
  expect(screen.getByLabelText("材料类型")).toHaveValue("resume");
});

test("切换到粘贴方式后按所选材料类型提交原内容", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  render(<MaterialsPage taskId={7} sources={[]} onChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("材料类型"), { target: { value: "job_description" } });
  fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
  fireEvent.change(screen.getByLabelText("材料名称"), { target: { value: "岗位" } });
  fireEvent.change(screen.getByLabelText("粘贴材料"), { target: { value: "开发知识库问答服务" } });
  fireEvent.click(screen.getByRole("button", { name: "导入粘贴材料" }));
  expect(await screen.findByRole("status")).toHaveTextContent("粘贴材料已导入");
  expect(fetchMock).toHaveBeenCalledWith("/api/tasks/7/sources/text", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "job_description", label: "岗位", text: "开发知识库问答服务" }),
  });
});

test("目录导入保留相对路径与文件内容", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ imported_count: 1, skipped_paths: [], errors: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<MaterialsPage taskId={7} sources={[]} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "项目目录" }));
  const file = new File(["print('ok')"], "app.py", { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", { value: "demo/src/app.py" });
  fireEvent.change(screen.getByLabelText("选择项目目录"), { target: { files: [file] } });
  await screen.findByText("已导入 1 个文件");
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/tasks/7/sources/import");
  expect(init.method).toBe("POST");
  expect(init.body.get("kind")).toBe("project");
  const uploaded = init.body.get("files") as File;
  expect(uploaded.name).toBe("demo/src/app.py");
  expect(uploaded.size).toBe(file.size);
});

test("材料列表使用中文类型并在列表标题旁展示数量", () => {
  render(<MaterialsPage taskId={7} sources={[{ id: 1, kind: "resume", label: "演示简历", relative_path: "resume.md" }]} onChanged={vi.fn()} />);
  expect(screen.getByText("1 份材料")).toBeInTheDocument();
  expect(screen.getByText("简历", { selector: ".material-kind" })).toBeInTheDocument();
  expect(screen.getByText("resume.md")).toBeInTheDocument();
});

test("材料就绪后可以提取能力主张并刷新任务", async () => {
  const onChanged = vi.fn();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal("fetch", fetchMock);

  render(<MaterialsPage taskId={7} sources={[{ id: 1, kind: "resume", label: "简历", relative_path: "pasted/简历.txt" }]} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "提取能力主张" }));

  expect(await screen.findByText("已提取 0 条能力主张")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/tasks/7/claims/generate", { method: "POST" });
  expect(onChanged).toHaveBeenCalledOnce();
});
