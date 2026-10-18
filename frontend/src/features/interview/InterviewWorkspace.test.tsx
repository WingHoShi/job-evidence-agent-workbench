import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { InterviewWorkspace } from "./InterviewWorkspace";
import { jsonResponse } from "./interviewFixtures.test-utils";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("提供默认综合模式，并可展开高级设置", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
  render(<InterviewWorkspace taskId={7} reportReady onChanged={vi.fn()} />);
  expect(await screen.findByText(/默认综合模式/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "使用高级设置" }));
  expect(screen.getByLabelText("题数")).toBeInTheDocument();
});

test("报告未生成时解释面试锁定原因且不请求模型", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<InterviewWorkspace taskId={7} reportReady={false} onChanged={vi.fn()} />);
  expect(screen.getByText("生成审计报告后可开始模拟面试")).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});
