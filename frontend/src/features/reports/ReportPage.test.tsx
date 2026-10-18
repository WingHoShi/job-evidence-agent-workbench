import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ReportPage } from "./ReportPage";

afterEach(() => {
  vi.restoreAllMocks();
});

test("生成完成后展示报告并提供 Markdown 下载", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          task_id: 3,
          generated_at: "2026-09-18T18:00:00",
          confirmed_claims: [["熟悉 FastAPI", "简历第 1 段"]],
          insufficient_claims: ["掌握 Kubernetes"],
          next_steps: ["补充材料不足的主张证据"],
          conflicts: [], jd_coverage: "未导入岗位描述", jd_requirements: [],
          claim_reviews: [{ claim_id: 1, text: "熟悉 FastAPI", resume_locator: "简历第 1 段", review_status: "人工已接受", verdict: "未判定", risk: "待评估", rationale: "未运行判定", gate_reason: "尚无门禁", warning: "人工接受不等于证据充分", evidence: [], suggestions: [] }],
        }),
        { status: 200 },
      ),
    ),
  );

  render(<ReportPage taskId={3} />);
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "岗位匹配与证据审计报告" })).toBeInTheDocument());
  expect(screen.getByText("人工已接受")).toBeInTheDocument();
  expect(screen.getByText("未判定")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "下载 Markdown" })).toHaveAttribute("href", "/api/tasks/3/report.md");
});

test("待审核主张未完成时说明无法生成报告", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "仍有待审核主张" }), { status: 409 })));

  render(<ReportPage taskId={3} />);
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("仍有待审核主张");
});
