import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { NewTaskPage } from "./NewTaskPage";

afterEach(() => {
  vi.restoreAllMocks();
});

test("创建任务后显示材料导入入口", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 3, name: "AI 应用开发岗位", status: "draft" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );

  render(<NewTaskPage />);
  fireEvent.change(screen.getByLabelText("任务名称"), {
    target: { value: "AI 应用开发岗位" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建任务" }));

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "导入材料" })).toBeInTheDocument();
  });
  expect(screen.getByText("当前任务：AI 应用开发岗位")).toBeInTheDocument();
});

test("生成主张后可确认审核状态", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 3, name: "AI 应用开发岗位", status: "draft" }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 8, text: "熟悉 FastAPI", resume_locator: "第 1 段", capability_tags: ["fastapi"], status: "pending_review" }]), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 8, text: "熟悉 FastAPI", resume_locator: "第 1 段", capability_tags: ["fastapi"], status: "confirmed" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<NewTaskPage />);
  fireEvent.change(screen.getByLabelText("任务名称"), { target: { value: "AI 应用开发岗位" } });
  fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
  await screen.findByRole("heading", { name: "导入材料" });
  fireEvent.click(screen.getByRole("button", { name: "生成待审核主张" }));
  expect(await screen.findByText("熟悉 FastAPI")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() => expect(screen.getByText("状态：confirmed")).toBeInTheDocument());
});
