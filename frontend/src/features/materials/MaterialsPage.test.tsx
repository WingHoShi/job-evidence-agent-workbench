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
  fireEvent.change(screen.getByLabelText("材料名称"), { target: { value: "岗位描述" } });
  fireEvent.change(screen.getByLabelText("粘贴材料"), { target: { value: "负责 AI 应用开发" } });
  fireEvent.click(screen.getByRole("button", { name: "导入粘贴材料" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("材料内容无法导入");
  expect(onChanged).not.toHaveBeenCalled();
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
