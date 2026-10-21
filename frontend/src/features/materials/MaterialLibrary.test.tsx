import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MaterialsPage } from "./MaterialsPage";

const sources = [
  { id: 1, kind: "resume", label: "示例简历", relative_path: "resume.md" },
  { id: 2, kind: "project", label: "app.py", relative_path: "health-service/src/app.py" },
  { id: 3, kind: "job_description", label: "岗位要求", relative_path: "JD.txt" },
];
const page = (id = 2, offset = 0, total = 1) => ({ task_id: 7, source: sources.find((source) => source.id === id)!, total, offset, limit: 10,
  chunks: [{ id: offset + 10, locator: `line:${offset + 1}`, text: `<script>不执行</script>\n原文片段 ${offset}` }] });
const response = (body: unknown) => new Response(JSON.stringify(body));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function show() { return render(<MaterialsPage taskId={7} sources={sources} onChanged={vi.fn()} />); }
function open(label = "app.py") { fireEvent.click(screen.getByRole("button", { name: `查看解析内容：${label}` })); }

test("按名称和路径搜索、类型组合筛选，不请求服务或改变导入草稿", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); show();
  fireEvent.click(screen.getByRole("button", { name: "粘贴文本" }));
  fireEvent.change(screen.getByLabelText("材料名称"), { target: { value: "未提交草稿" } });
  fireEvent.change(screen.getByLabelText("搜索材料"), { target: { value: "示例" } });
  expect(screen.getByText("示例简历")).toBeInTheDocument(); expect(screen.queryByText("app.py")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("搜索材料"), { target: { value: " HEALTH-SERVICE " } });
  expect(screen.getByText("app.py")).toBeInTheDocument(); expect(screen.queryByText("示例简历")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("筛选材料类型"), { target: { value: "resume" } });
  expect(screen.getByText("没有符合条件的材料")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(screen.getByText("示例简历")).toBeInTheDocument();
  expect(screen.getByLabelText("材料名称")).toHaveValue("未提交草稿"); expect(fetch).not.toHaveBeenCalled();
});

test("主动查看才GET片段，以纯文本展示原文和定位，不改变任务", async () => {
  const fetch = vi.fn().mockResolvedValue(response(page())); vi.stubGlobal("fetch", fetch); const view = show();
  expect(fetch).not.toHaveBeenCalled(); open();
  const preview = await screen.findByRole("region", { name: "解析内容预览" });
  expect(await within(preview).findByText(/原文片段 0/)).toHaveTextContent("<script>不执行</script>");
  expect(within(preview).getByText("line:1")).toBeInTheDocument();
  expect(preview).toHaveTextContent("不是原文件全文"); expect(view.container.querySelector("script")).toBeNull();
  expect(fetch).toHaveBeenCalledWith("/api/tasks/7/sources/2/chunks?offset=0&limit=10", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
  expect(screen.queryByRole("region", { name: "解析内容预览" })).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce();
});

test("快速切换后忽略旧请求迟到的结果", async () => {
  let first!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { first = resolve; })).mockResolvedValueOnce(response({ ...page(1), chunks: [{ id: 99, locator: "简历", text: "当前简历内容" }] })));
  show(); open(); expect(screen.getByText("正在读取解析内容…")).toBeInTheDocument(); open("示例简历");
  expect(await screen.findByText("当前简历内容")).toBeInTheDocument();
  await act(async () => first(response(page())));
  expect(screen.queryByText(/原文片段 0/)).not.toBeInTheDocument();
});

test.each(["http", "network", "identity", "source-identity", "shape"])("预览失败（%s）不展示旧内容，允许手动重试GET", async (mode) => {
  const fetch = vi.fn().mockImplementationOnce(async () => {
    if (mode === "network") throw new Error("offline");
    if (mode === "http") return new Response("internal", { status: 503 });
    if (mode === "source-identity") return response({ ...page(), source: sources[0] });
    return response(mode === "identity" ? { ...page(), task_id: 8 } : { ...page(), chunks: [{ id: 1 }] });
  }).mockResolvedValueOnce(response(page())); vi.stubGlobal("fetch", fetch); show(); open();
  expect(await screen.findByRole("alert")).toHaveTextContent("解析内容读取失败");
  expect(screen.queryByText(/原文片段/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  expect(await screen.findByText(/原文片段 0/)).toBeInTheDocument(); expect(fetch).toHaveBeenCalledTimes(2);
});

test("分页只读取当前页并提供前后翻页", async () => {
  const first = { ...page(2, 0, 11), chunks: Array.from({ length: 10 }, (_, index) => ({ id: index + 1, locator: `line:${index}`, text: `第一页内容 ${index}` })) };
  const fetch = vi.fn().mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response({ ...page(2, 10, 11), chunks: [{ id: 11, locator: "line:11", text: "第二页内容" }] }));
  vi.stubGlobal("fetch", fetch); show(); open();
  expect(await screen.findByText("第一页内容 0")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(await screen.findByText("第二页内容")).toBeInTheDocument(); expect(screen.queryByText("第一页内容 0")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenLastCalledWith("/api/tasks/7/sources/2/chunks?offset=10&limit=10", expect.anything());
  expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
});

test("筛掉所选材料会关闭预览，迟到结果不能重新打开", async () => {
  let finish!: (value: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  show(); open(); fireEvent.change(screen.getByLabelText("搜索材料"), { target: { value: "not-found" } });
  expect(screen.queryByRole("region", { name: "解析内容预览" })).not.toBeInTheDocument();
  await act(async () => finish(response(page())));
  expect(screen.queryByText(/原文片段 0/)).not.toBeInTheDocument();
});

test("空解析结果明确提示，不捏造原文", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...page(), total: 0, chunks: [] }))); show(); open();
  expect(await screen.findByText("这份材料没有已入库的文本片段。")).toBeInTheDocument();
});

test("切换任务时清除预览和筛选，旧任务响应不能展示", async () => {
  let finish!: (value: Response) => void; const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch); const view = show(); open();
  view.rerender(<MaterialsPage taskId={8} sources={[{ ...sources[1], label: "新任务材料" }]} onChanged={vi.fn()} />);
  expect(screen.queryByRole("region", { name: "解析内容预览" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("搜索材料")).toHaveValue("");
  await act(async () => finish(response(page())));
  expect(screen.queryByText(/原文片段 0/)).not.toBeInTheDocument();
});

test("超时后明确报错且不自动重试，迟到响应不能覆盖失败状态", async () => {
  vi.useFakeTimers(); let finish!: (value: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", fetch); show(); open();
  await act(async () => { vi.advanceTimersByTime(15000); });
  expect(screen.getByRole("alert")).toHaveTextContent("解析内容读取失败");
  await act(async () => finish(response(page())));
  expect(screen.queryByText(/原文片段 0/)).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce();
});
