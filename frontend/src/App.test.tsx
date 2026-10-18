import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import App from "./App";

test("未配置模型时显示初始化模型配置", () => {
  render(<App />);

  expect(
    screen.getByRole("heading", { name: "初始化模型配置" }),
  ).toBeInTheDocument();
});

test("已配置模型时进入新版任务工作台", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ configured: true, base_url: "https://example.com/v1", model_name: "test-model" }),
  }));
  render(<App />);

  expect(await screen.findByRole("heading", { name: "新建求职任务" })).toBeInTheDocument();
});
