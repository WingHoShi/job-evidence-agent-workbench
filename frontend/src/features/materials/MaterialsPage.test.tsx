import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { MaterialsPage } from "./MaterialsPage";

afterEach(() => vi.unstubAllGlobals());

test("导入文件后显示导入数量并通知任务刷新", async () => {
  const onChanged = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ imported_count: 1, skipped_paths: [], errors: [] }) }));

  render(<MaterialsPage taskId={7} sources={[]} onChanged={onChanged} />);
  const file = new File(["# 简历"], "resume.md", { type: "text/markdown" });
  fireEvent.change(screen.getByLabelText("批量选择文件"), { target: { files: [file] } });

  expect(await screen.findByText("已导入 1 个文件")).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledOnce();
});

test("导入粘贴材料失败时展示可理解的错误", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ detail: "材料内容无法导入" }),
  }));
  const onChanged = vi.fn();

  render(<MaterialsPage taskId={7} sources={[]} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
  fireEvent.change(screen.getByLabelText("材料名称"), { target: { value: "岗位描述" } });
  fireEvent.change(screen.getByLabelText("粘贴材料"), { target: { value: "负责 AI 应用开发" } });
  fireEvent.click(screen.getByRole("button", { name: "导入粘贴材料" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("材料内容无法导入");
  expect(onChanged).not.toHaveBeenCalled();
});

test("切换导入方式只展示当前入口并保留粘贴草稿与材料类型", () => {
  render(<MaterialsPage taskId={7} sources={[]} onChanged={vi.fn()} />);
  expect(screen.getByLabelText("批量选择文件")).toBeInTheDocument();
  expect(screen.queryByLabelText("材料名称")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("材料类型"), { target: { value: "resume" } });
  fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
  fireEvent.change(screen.getByLabelText("材料名称"), { target: { value: "我的简历" } });
  fireEvent.change(screen.getByLabelText("粘贴材料"), { target: { value: "保留这份草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "项目目录" }));
  expect(screen.queryByLabelText("粘贴材料")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "选择项目目录" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
  expect(screen.getByLabelText("材料名称")).toHaveValue("我的简历");
  expect(screen.getByLabelText("粘贴材料")).toHaveValue("保留这份草稿");
  expect(screen.getByLabelText("材料类型")).toHaveValue("resume");
});

test("切换到粘贴方式后按所选材料类型提交原内容", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  render(<MaterialsPage taskId={7} sources={[]} onChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("材料类型"), { target: { value: "job_description" } });
  fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
  fireEvent.change(screen.getByLabelText("材料名称"), { target: { value: "岗位" } });
  fireEvent.change(screen.getByLabelText("粘贴材料"), { target: { value: "开发知识库问答服务" } });
  fireEvent.click(screen.getByRole("button", { name: "导入粘贴材料" }));
  expect(await screen.findByText("粘贴材料已导入")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/tasks/7/sources/text", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "job_description", label: "岗位", text: "开发知识库问答服务" }),
  });
});

test("目录导入保留相对路径与文件内容", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ imported_count: 1, skipped_paths: [], errors: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<MaterialsPage taskId={7} sources={[]} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "项目目录" }));
  const file = new File(["print('ok')"], "app.py", { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", { value: "demo/src/app.py" });
  fireEvent.change(screen.getByLabelText("选择项目目录"), { target: { files: [file] } });
  await screen.findByText("已导入 1 个文件");
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/tasks/7/sources/import");
  expect(init.method).toBe("POST");
  expect(init.body.get("kind")).toBe("project");
  const uploaded = init.body.get("files") as File;
  expect(uploaded.name).toBe("demo/src/app.py");
  expect(uploaded.size).toBe(file.size);
});

test("材料列表使用中文类型并在列表标题旁展示数量", () => {
  render(<MaterialsPage taskId={7} sources={[{ id: 1, kind: "resume", label: "演示简历", relative_path: "resume.md" }]} onChanged={vi.fn()} />);
  expect(screen.getByText("1 份材料")).toBeInTheDocument();
  expect(screen.getByText("简历", { selector: ".material-kind" })).toBeInTheDocument();
  expect(screen.getByText("resume.md")).toBeInTheDocument();
});

test("材料就绪后可以提取能力主张并刷新任务", async () => {
  const onChanged = vi.fn();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 1 }] });
  vi.stubGlobal("fetch", fetchMock);

  render(<MaterialsPage taskId={7} sources={[{ id: 1, kind: "resume", label: "简历", relative_path: "pasted/简历.txt" }]} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "提取能力主张" }));

  expect(await screen.findByText("已提取 1 条能力主张")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/tasks/7/claims/generate", { method: "POST" });
  expect(onChanged).toHaveBeenCalledOnce();
});

test("文件导入中锁定入口和材料类型，重复操作不会再发送请求", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch);
  render(<MaterialsPage taskId={7} sources={[{ id: 1, kind: "resume", label: "简历", relative_path: "resume.md" }]} onChanged={vi.fn()} />);
  const input = screen.getByLabelText("批量选择文件");
  const file = new File(["demo"], "demo.md");
  fireEvent.change(input, { target: { files: [file] } });
  expect(screen.getByRole("status")).toHaveTextContent("正在导入 1 个文件");
  expect(input).toBeDisabled(); expect(screen.getByLabelText("材料类型")).toBeDisabled();
  expect(screen.getByRole("button", { name: "粘贴文本" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "提取能力主张" })).toBeDisabled();
  fireEvent.change(input, { target: { files: [file] } });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => finish(new Response(JSON.stringify({ imported_count: 1, skipped_paths: [], errors: [] }))));
  expect(input).toBeEnabled();
  expect(await screen.findByText("已导入 1 个文件")).toBeInTheDocument();
});

test("部分导入显示成功和跳过计数、错误条数，明细默认折叠且不重复累计失败", async () => {
  const onChanged = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ imported_count: 2, skipped_paths: ["demo/.env", "demo/broken.pdf"], errors: ["demo/broken.pdf: 无法提取文本"] }))));
  render(<MaterialsPage taskId={7} sources={[]} onChanged={onChanged} />);
  fireEvent.change(screen.getByLabelText("批量选择文件"), { target: { files: ["app.py", "README.md", ".env", "broken.pdf"].map((name) => new File(["demo"], name)) } });
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("已导入 2 个文件"); expect(alert).toHaveTextContent("已跳过 2 个文件"); expect(alert).toHaveTextContent("1 条错误信息");
  expect(screen.getByText(/解析失败的文件也计入跳过数量/)).toBeInTheDocument();
  const details = screen.getByText("查看跳过与错误明细").closest("details");
  expect(details).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("查看跳过与错误明细"));
  expect(screen.getByText("demo/broken.pdf: 无法提取文本")).toBeVisible();
  expect(onChanged).toHaveBeenCalledOnce();
});

test.each(["network", "json", "shape", "http"])("未确认导入结果（%s）不假称成功或自动重传，允许只刷新列表", async (failure) => {
  const fetch = vi.fn(async () => {
    if (failure === "network") throw new Error("network interrupted");
    if (failure === "json") return new Response("broken JSON");
    if (failure === "http") return new Response(JSON.stringify({ detail: "internal" }), { status: 500 });
    return new Response(JSON.stringify({ imported_count: 1 }));
  });
  vi.stubGlobal("fetch", fetch); const onChanged = vi.fn();
  render(<MaterialsPage taskId={7} sources={[]} onChanged={onChanged} />);
  fireEvent.change(screen.getByLabelText("批量选择文件"), { target: { files: [new File(["demo"], "demo.md")] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("未能确认本次导入结果");
  expect(screen.getByRole("alert")).toHaveTextContent("不要直接重复上传");
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "刷新材料列表" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("导入已确认但刷新失败时保留成功结果，只重试刷新而不是再上传", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imported_count: 1, skipped_paths: [], errors: [] })));
  const onChanged = vi.fn().mockRejectedValueOnce(new Error("refresh failed")).mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetch);
  render(<MaterialsPage taskId={7} sources={[]} onChanged={onChanged} />);
  fireEvent.change(screen.getByLabelText("批量选择文件"), { target: { files: [new File(["demo"], "demo.md")] } });
  expect(await screen.findByText("已导入 1 个文件")).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("材料已保存，但列表刷新失败");
  fireEvent.click(screen.getByRole("button", { name: "刷新材料列表" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  expect(fetch).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByText(/列表刷新失败/)).not.toBeInTheDocument());
});

test("粘贴导入等待时防止重复提交，网络中断保留草稿并提示核对", async () => {
  let fail!: (reason: Error) => void;
  const fetch = vi.fn(() => new Promise((_resolve, reject) => { fail = reject; }));
  vi.stubGlobal("fetch", fetch);
  render(<MaterialsPage taskId={7} sources={[]} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
  fireEvent.change(screen.getByLabelText("材料名称"), { target: { value: "我的说明" } });
  fireEvent.change(screen.getByLabelText("粘贴材料"), { target: { value: "需要保留的草稿" } });
  const submit = screen.getByRole("button", { name: "导入粘贴材料" });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(fetch).toHaveBeenCalledOnce(); expect(screen.getByLabelText("粘贴材料")).toBeDisabled();
  await act(async () => fail(new Error("offline")));
  expect(await screen.findByRole("alert")).toHaveTextContent("未能确认本次导入结果");
  expect(screen.getByLabelText("材料名称")).toHaveValue("我的说明");
  expect(screen.getByLabelText("粘贴材料")).toHaveValue("需要保留的草稿");
});

test("全部跳过时不伪装成功入库，错误明细可见且可重新选择同名文件", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ imported_count: 0, skipped_paths: ["broken.pdf"], errors: ["broken.pdf: 无法解析"] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ imported_count: 1, skipped_paths: [], errors: [] })));
  vi.stubGlobal("fetch", fetch);
  render(<MaterialsPage taskId={7} sources={[]} onChanged={vi.fn()} />);
  const input = screen.getByLabelText("批量选择文件");
  const file = new File(["demo"], "broken.pdf");
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("已导入 0 个文件");
  await waitFor(() => expect(input).toBeEnabled());
  expect(input).toHaveValue("");
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByText("已导入 1 个文件")).toBeInTheDocument();
  expect(screen.queryByText("查看跳过与错误明细")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
});
