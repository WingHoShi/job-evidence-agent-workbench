import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ReportWorkspacePage } from "./ReportWorkspacePage";

test("审核未完成时锁定报告生成", () => {
  render(<ReportWorkspacePage taskId={7} auditStatus="awaiting_review" onGenerated={vi.fn()} />);

  expect(screen.getByText("完成全部主张审核后可生成报告")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成审计报告" })).toBeDisabled();
});

test("报告生成失败时展示可理解提示", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ detail: "报告生成失败，请稍后重试" }),
  }));
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" onGenerated={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("报告生成失败，请稍后重试");
});

test("报告区分人工决定与证据支持度并展示来源和岗位初筛", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    generated_at: "2026-10-07T12:00:00",
    confirmed_claims: [["使用 FastAPI 和 Docker Compose", "简历1"]],
    insufficient_claims: ["使用 FastAPI 和 Docker Compose", "性能优化"],
    conflicts: [], jd_coverage: "规则初筛，不代表岗位匹配率",
    jd_requirements: [{ text: "熟悉 FastAPI", locator: "岗位 · 要求", keywords: ["fastapi"], claim_ids: [1], status: "有关联主张，证据待补" }],
    next_steps: ["补充 Docker Compose 配置"],
    claim_reviews: [
      { claim_id: 1, text: "使用 FastAPI 和 Docker Compose", resume_locator: "简历1", review_status: "人工已接受", verdict: "部分支持", risk: "需关注", rationale: "缺少编排配置", gate_reason: "证据不足", warning: "人工接受不等于证据充分", evidence: [{ chunk_id: 8, source_kind: "project", source_label: "服务代码", relative_path: "src/app.py", locator: "第1行", excerpt: "from fastapi import FastAPI" }], suggestions: ["补充 Docker Compose 配置"] },
      { claim_id: 2, text: "性能优化", resume_locator: "简历2", review_status: "人工已拒绝", verdict: "没有证据", risk: "需关注", rationale: "无测试记录", gate_reason: "无证据", warning: "", evidence: [], suggestions: ["补充性能测试"] },
    ],
  }), { status: 200 })));
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" onGenerated={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  expect(await screen.findByText("人工已接受")).toBeInTheDocument();
  expect(screen.getByText("人工已拒绝")).toBeInTheDocument();
  expect(screen.getByText("部分支持")).toBeInTheDocument();
  expect(screen.getAllByText(/人工接受不等于证据充分/).length).toBeGreaterThan(0);
  expect(screen.getByText(/src\/app.py/)).toBeInTheDocument();
  expect(screen.getByText("有关联主张，证据待补")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "下载 Markdown" })).toHaveAttribute("href", "/api/tasks/7/report.md");
});
