import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import App from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const unconfigured = { configured: false, base_url: null, model_name: null };
const configured = { configured: true, base_url: "https://example.com/v1", model_name: "test-model" };
const response = (body: unknown) => ({ ok: true, json: async () => body });

test("配置未读取完成时只显示连接状态，不闪现初始化表单", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<App />);
  expect(screen.getByRole("status")).toHaveTextContent("正在连接工作台");
  expect(screen.queryByRole("heading", { name: "初始化模型配置" })).not.toBeInTheDocument();
});

test("明确未配置模型时才显示初始化模型配置", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(unconfigured)));
  render(<App />);
  expect(await screen.findByRole("heading", { name: "初始化模型配置" })).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("已配置模型时进入新版任务工作台", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => response(url === "/api/setup/status" ? configured : [])));
  render(<App />);

  expect(await screen.findByRole("heading", { name: "新建求职任务" })).toBeInTheDocument();
});

test.each(["network", "http", "json", "shape"])("配置读取失败（%s）时提供重试，不误判为未配置", async (failure) => {
  const fetch = vi.fn(async () => {
    if (failure === "network") throw new Error("private internal error");
    if (failure === "http") return { ok: false, json: async () => unconfigured };
    if (failure === "json") return { ok: true, json: async () => { throw new Error("invalid JSON"); } };
    return response({ configured: "false" });
  });
  vi.stubGlobal("fetch", fetch);
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法连接工作台");
  expect(screen.getByRole("button", { name: "重新连接" })).toBeEnabled();
  expect(screen.queryByRole("heading", { name: "初始化模型配置" })).not.toBeInTheDocument();
  expect(screen.queryByText("private internal error")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([true, false])("手动重试重新读取配置，等待期间不能重复触发，恢复后按配置分流（%s）", async (isConfigured) => {
  let resolveStatus!: (value: ReturnType<typeof response>) => void;
  const fetch = vi.fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveStatus = resolve; }))
    .mockResolvedValue(response([]));
  vi.stubGlobal("fetch", fetch);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "重新连接" }));
  expect(screen.getByRole("status")).toHaveTextContent("正在连接工作台");
  expect(screen.queryByRole("button", { name: "重新连接" })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => resolveStatus(response(isConfigured ? configured : unconfigured)));
  expect(await screen.findByRole("heading", { name: isConfigured ? "新建求职任务" : "初始化模型配置" })).toBeInTheDocument();
  for (const [url, options] of fetch.mock.calls) {
    expect(url === "/api/setup/status" || url === "/api/tasks").toBe(true);
    expect(options?.method ?? "GET").toBe("GET");
  }
});

test("配置请求长期无响应时提供手动重试，迟到的旧响应不覆盖重试结果", async () => {
  vi.useFakeTimers();
  let resolveOld!: (value: ReturnType<typeof response>) => void;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValue(response(unconfigured));
  vi.stubGlobal("fetch", fetch);
  render(<App />);
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(screen.getByRole("alert")).toHaveTextContent("暂时无法连接工作台");
  fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
  await act(async () => {});
  expect(screen.getByRole("heading", { name: "初始化模型配置" })).toBeInTheDocument();
  await act(async () => resolveOld(response(configured)));
  expect(screen.getByRole("heading", { name: "初始化模型配置" })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
});
