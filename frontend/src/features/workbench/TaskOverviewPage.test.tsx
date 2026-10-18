import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { TaskOverviewPage } from "./TaskOverviewPage";
import { TaskSnapshot } from "./types";

const snapshot: TaskSnapshot = {
  id: 7,
  name: "AI 应用开发岗位",
  status: "draft",
  sources: [{ id: 1, kind: "resume", label: "简历", relative_path: "pasted/简历.txt" }],
  claims: [
    { id: 1, text: "使用 FastAPI 提供服务", resume_locator: "简历:1", capability_tags: [], status: "confirmed" },
    { id: 2, text: "掌握 Docker", resume_locator: "简历:2", capability_tags: [], status: "pending_review" },
  ],
  assessments: {},
  gates: {},
  report_ready: false,
  audit: { status: "awaiting_review", claim_id: 2, events: ["已导入简历"], recoverable: true },
};

test("展示待处理队列并将继续审核导向审计页", async () => {
  const onNavigate = vi.fn();
  render(<TaskOverviewPage snapshot={snapshot} onNavigate={onNavigate} />);

  expect(screen.getByText("能力主张总数")).toBeInTheDocument();
  expect(screen.getByText("待人工确认")).toBeInTheDocument();
  expect(screen.getByText("掌握 Docker")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "继续审核" }));
  expect(onNavigate).toHaveBeenCalledWith("audit");
});

test("空任务提示先导入材料并跳转材料中心", () => {
  const onNavigate = vi.fn();
  render(<TaskOverviewPage snapshot={{ ...snapshot, sources: [], claims: [] }} onNavigate={onNavigate} />);

  expect(screen.getByText("先导入简历、岗位描述或项目材料")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "导入材料" }));
  expect(onNavigate).toHaveBeenCalledWith("materials");
});

test("审核完成后将下一步导向报告或模拟面试", () => {
  const onNavigate = vi.fn();
  render(<TaskOverviewPage snapshot={{ ...snapshot, audit: { status: "completed", claim_id: null, events: [], recoverable: false }, report_ready: false }} onNavigate={onNavigate} />);

  expect(screen.getByRole("button", { name: "生成报告" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
  expect(onNavigate).toHaveBeenCalledWith("report");
});
