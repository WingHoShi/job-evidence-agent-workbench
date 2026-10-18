import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { SetupPage } from "./SetupPage";

const defaultFormValues = () => {
  fireEvent.change(screen.getByLabelText("Base URL"), {
    target: { value: "https://api.example.com/v1" },
  });
  fireEvent.change(screen.getByLabelText("模型名"), {
    target: { value: "test-model" },
  });
  fireEvent.change(screen.getByLabelText("API Key"), {
    target: { value: "sk-secret-value" },
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

test("连接测试失败时展示安全错误且不进入工作台", async () => {
  const onConfigured = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "模型服务拒绝了 API Key，请检查后重试" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

  render(<SetupPage onConfigured={onConfigured} />);
  defaultFormValues();
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

  expect(await screen.findByText("模型服务拒绝了 API Key，请检查后重试")).toBeInTheDocument();
  expect(onConfigured).not.toHaveBeenCalled();
  expect(screen.queryByText("sk-secret-value")).not.toBeInTheDocument();
});

test("保存成功后通知应用进入工作台", async () => {
  const onConfigured = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          configured: true,
          base_url: "https://api.example.com/v1",
          model_name: "test-model",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );

  render(<SetupPage onConfigured={onConfigured} />);
  defaultFormValues();
  fireEvent.click(screen.getByRole("button", { name: "保存并进入工作台" }));

  await waitFor(() => expect(onConfigured).toHaveBeenCalledTimes(1));
  expect(onConfigured).toHaveBeenCalledWith({
    configured: true,
    base_url: "https://api.example.com/v1",
    model_name: "test-model",
  });
});
