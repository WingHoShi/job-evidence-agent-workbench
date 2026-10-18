import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { WorkbenchShell } from "./WorkbenchShell";

test("显示任务导航、当前页面和锁定阶段原因", () => {
  const onNavigate = vi.fn();

  render(
    <WorkbenchShell
      activePage="overview"
      onNavigate={onNavigate}
      lockedPages={{ report: "完成审核后可生成", interview: "生成报告后可开始" }}
    >
      <h1>任务概览</h1>
    </WorkbenchShell>,
  );

  expect(screen.getByRole("navigation", { name: "任务导航" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "任务概览" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "审计报告" })).toBeDisabled();
  expect(screen.getByText("完成审核后可生成")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "任务概览" })).toBeInTheDocument();
});
