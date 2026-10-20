import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { WorkbenchShell } from "../workbench/WorkbenchShell";

const current = { configured: true, base_url: "https://api.example.com/v1", model_name: "original-model" };
const changed = { configured: true, base_url: "https://new.example.com/v1", model_name: "my-model" };
function response(body: unknown, ok = true) { return { ok, json: async () => body }; }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); sessionStorage.clear(); });

async function open() {
  render(<WorkbenchShell activePage="overview" onNavigate={() => {}}><input aria-label="当前页面草稿" defaultValue="未提交内容" /></WorkbenchShell>);
  fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
  const dialog = await screen.findByRole("dialog", { name: "模型设置" });
  await within(dialog).findByDisplayValue(current.base_url);
  return dialog;
}
function edit(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText("Base URL"), { target: { value: changed.base_url } });
  fireEvent.change(within(dialog).getByLabelText("模型名称"), { target: { value: changed.model_name } });
  fireEvent.change(within(dialog).getByLabelText("API Key"), { target: { value: "fictional-key-not-a-credential" } });
}

test("打开设置仅GET安全状态，密钥留空，不卸载当前页面；关闭后恢复焦点", async () => {
  const fetch = vi.fn().mockResolvedValue(response(current));
  vi.stubGlobal("fetch", fetch);
  const dialog = await open();
  expect(within(dialog).getByLabelText("API Key")).toHaveValue("");
  expect(within(dialog).getByLabelText("API Key")).toHaveAttribute("type", "password");
  expect(within(dialog).getByText(/可能产生费用/)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/setup/status", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getByLabelText("当前页面草稿")).toHaveValue("未提交内容");
  expect(screen.getByLabelText("当前页面草稿").closest(".app-shell")).toHaveAttribute("inert");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "模型设置" })).toHaveFocus();
  expect(screen.getByLabelText("当前页面草稿")).toHaveValue("未提交内容");
});

test("测试连接只请求test接口，不保存，保留当前生效配置与新输入", async () => {
  const fetch = vi.fn().mockImplementation(async (url) => response(url === "/api/setup/status" ? current : changed));
  vi.stubGlobal("fetch", fetch);
  const dialog = await open(); edit(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "测试连接" }));
  expect(await within(dialog).findByRole("status")).toHaveTextContent("连接测试通过，尚未保存");
  expect(within(dialog).getByText(current.model_name)).toBeInTheDocument();
  expect(fetch).toHaveBeenLastCalledWith("/api/setup/test", expect.objectContaining({
    method: "POST", body: JSON.stringify({ base_url: changed.base_url, model_name: changed.model_name, api_key: "fictional-key-not-a-credential" }),
  }));
  expect(fetch.mock.calls.filter(([url]) => url === "/api/setup")).toHaveLength(0);
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

test("保存成功后更新生效摘要并清空密钥，关闭返回原页面", async () => {
  const fetch = vi.fn().mockImplementation(async (url) => response(url === "/api/setup/status" ? current : changed));
  vi.stubGlobal("fetch", fetch);
  const dialog = await open(); edit(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));
  expect(await within(dialog).findByRole("status")).toHaveTextContent("配置已保存");
  expect(within(dialog).getByText(changed.model_name)).toBeInTheDocument();
  expect(within(dialog).queryByText(current.model_name)).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText("API Key")).toHaveValue("");
  expect(fetch).toHaveBeenLastCalledWith("/api/setup", expect.objectContaining({ method: "POST" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭设置" }));
  expect(screen.getByLabelText("当前页面草稿")).toHaveValue("未提交内容");
});

test("测试失败或保存被拒绝不替换生效摘要，不回显服务端秘密", async () => {
  const fetch = vi.fn().mockImplementation(async (url) => url === "/api/setup/status"
    ? response(current) : response({ detail: "fictional-key-not-a-credential" }, false));
  vi.stubGlobal("fetch", fetch);
  const dialog = await open(); edit(dialog);
  for (const name of ["测试连接", "保存配置"]) {
    fireEvent.click(within(dialog).getByRole("button", { name }));
    expect(await within(dialog).findByRole("alert")).not.toHaveTextContent("fictional-key-not-a-credential");
    expect(within(dialog).getByText(current.model_name)).toBeInTheDocument();
  }
});

test("保存网络中断时不声称未保存，提醒重新读取确认", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url) => {
    if (url === "/api/setup/status") return response(current);
    throw new Error("connection lost");
  }));
  const dialog = await open(); edit(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("未确认保存结果");
});

test("请求处理中锁定编辑和关闭，重复点击不会产生第二次保存", async () => {
  let resolveSave!: (value: ReturnType<typeof response>) => void;
  const fetch = vi.fn().mockResolvedValueOnce(response(current))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const dialog = await open(); edit(dialog);
  const save = within(dialog).getByRole("button", { name: "保存配置" });
  fireEvent.click(save); fireEvent.click(save);
  expect(save).toBeDisabled(); expect(within(dialog).getByLabelText("Base URL")).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "关闭设置" })).toBeDisabled();
  fireEvent.keyDown(dialog, { key: "Escape" }); expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => resolveSave(response(changed)));
  expect(await within(dialog).findByRole("status")).toHaveTextContent("配置已保存");
});

test("读取配置失败时不能编辑，手动重试恢复，不自动调用模型", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(response(current));
  vi.stubGlobal("fetch", fetch);
  render(<WorkbenchShell activePage="overview" onNavigate={() => {}}>任务</WorkbenchShell>);
  fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("无法读取当前配置");
  expect(screen.queryByRole("button", { name: "保存配置" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await screen.findByDisplayValue(current.base_url);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("未填写新密钥不能提交；取消后重新打开不保留上次密钥", async () => {
  const fetch = vi.fn().mockResolvedValue(response(current));
  vi.stubGlobal("fetch", fetch);
  const dialog = await open();
  expect(within(dialog).getByRole("button", { name: "保存配置" })).toBeDisabled();
  edit(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭设置" }));
  fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
  await screen.findByDisplayValue(current.base_url);
  expect(screen.getByLabelText("API Key")).toHaveValue("");
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});

test("保存长时间无响应可退出等待，但明确提醒结果未确认且不自动重发", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(response(current))
    .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
  vi.stubGlobal("fetch", fetch);
  render(<WorkbenchShell activePage="overview" onNavigate={() => {}}>任务</WorkbenchShell>);
  fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
  await act(async () => {});
  const dialog = screen.getByRole("dialog"); edit(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("未确认保存结果");
  expect(within(dialog).getByRole("button", { name: "关闭设置" })).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("键盘焦点限制在设置弹窗内", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(current)));
  const dialog = await open(); edit(dialog);
  const close = within(dialog).getByRole("button", { name: "关闭设置" });
  const save = within(dialog).getByRole("button", { name: "保存配置" });
  save.focus(); fireEvent.keyDown(dialog, { key: "Tab" }); expect(close).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true }); expect(save).toHaveFocus();
});
