import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ClaimReviewCard } from "./ClaimReviewCard";

test("审核卡片展示主张、候选证据、模型判定与门禁并触发接受操作", () => {
  const onDecision = vi.fn();
  render(<ClaimReviewCard claim="熟悉 FastAPI" locator="简历第 1 段" evidence={['README：FastAPI 服务入口']} risk="需要人工确认个人职责" assessment={{ verdict: "partial", rationale: "README 中存在相关服务实现。" }} gate={{ eligible: false, requires_review: true, reason: "证据不足，需要补充或人工确认" }} onDecision={onDecision} />);

  expect(screen.getByText("熟悉 FastAPI")).toBeInTheDocument();
  expect(screen.getByText("README：FastAPI 服务入口")).toBeInTheDocument();
  expect(screen.getByText(/需要人工确认个人职责/)).toBeInTheDocument();
  expect(screen.getByText(/支持程度：部分支持/)).toBeInTheDocument();
  expect(screen.getByText(/证据不足，需要补充或人工确认/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "接受并继续" }));
  expect(onDecision).toHaveBeenCalledWith("accepted");
});
