import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ReportWorkspacePage } from "./ReportWorkspacePage";
import { reportFixture } from "./reportFixtures.test-utils";
import { isReport, type Report, type ReportViewState } from "./reportTypes";

let blobs: Blob[];
let downloads: { name: string; href: string }[];
const json = (body: unknown) => new Response(JSON.stringify(body));
const fixture = (taskId = 7, title = "虚构接口实现"): Report => {
  const report = reportFixture(taskId, title);
  if (!isReport(report, taskId)) throw new Error("Invalid fictional report fixture");
  return report;
};
const state = (report: Report, needsSync = false): ReportViewState => ({ id: 1, report, busy: null, needsSync,
  message: needsSync ? "报告已取得，但任务状态刷新失败。请刷新任务状态，不必重新生成报告。" : null });
function preventServerNavigation(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a[href$="/report.md"]')) event.preventDefault();
}
beforeEach(() => {
  blobs = []; downloads = [];
  class DownloadURL extends URL {
    static createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:local-report"; });
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", DownloadURL);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href });
  });
  document.addEventListener("click", preventServerNavigation);
});
afterEach(() => {
  document.removeEventListener("click", preventServerNavigation);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function text(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob);
  });
}
function download() { fireEvent.click(screen.getByText("下载 Markdown")); }

test("下载当前展示报告的原生成时间、结论与引用，不请求接口或修改报告状态", async () => {
  const report = fixture(); const before = JSON.stringify(report); const onGenerated = vi.fn(); const onStateChange = vi.fn();
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" state={state(report)} onGenerated={onGenerated} onStateChange={onStateChange} />);
  download();
  expect(downloads).toEqual([{ name: "report-7.md", href: "blob:local-report" }]);
  expect(blobs[0].type).toBe("text/markdown;charset=utf-8");
  const markdown = await text(blobs[0]);
  for (const value of ["生成时间：2026-10-22T10:00:00", "虚构接口实现", "人工已接受", "部分支持", "需关注", "仅有虚构接口代码", "需人工核对", "人工接受不等于证据充分", "补充运行记录", "[E8]", "src/app.py", 'app = FastAPI()', "岗位要求覆盖", "熟悉 Python", "岗位第1条", "python", "冲突材料", "下一步建议"]) expect(markdown).toContain(value);
  expect(markdown).not.toContain("导出时间：");
  expect(fetch).not.toHaveBeenCalled(); expect(onGenerated).not.toHaveBeenCalled(); expect(onStateChange).not.toHaveBeenCalled();
  expect(JSON.stringify(report)).toBe(before);
  expect(screen.getByRole("status")).toHaveTextContent("已发起下载");
  expect(document.querySelector('a[download]')).not.toBeInTheDocument();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-report"), { timeout: 2000 });
});

test("任务同步失败时仍可导出已取得的报告，不清除恢复提示或重新生成", async () => {
  const onGenerated = vi.fn(); const onStateChange = vi.fn();
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" state={state(fixture(), true)} onGenerated={onGenerated} onStateChange={onStateChange} />);
  download();
  expect(blobs).toHaveLength(1);
  expect(await text(blobs[0])).toContain("虚构接口实现");
  expect(screen.getByRole("alert")).toHaveTextContent("任务状态刷新失败");
  expect(screen.getByRole("button", { name: "刷新任务状态" })).toBeEnabled();
  expect(fetch).not.toHaveBeenCalled(); expect(onGenerated).not.toHaveBeenCalled(); expect(onStateChange).not.toHaveBeenCalled();
});

test("刷新失败后仅下载仍展示的上一版，不调用report.md或额外触发同步", async () => {
  const requests: string[] = []; const onGenerated = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requests.push(url);
    return requests.length === 1 ? json(fixture()) : new Response(null, { status: 503 });
  }));
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" onGenerated={onGenerated} />);
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  await screen.findByRole("heading", { name: "主张 1 · 虚构接口实现" });
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新报告" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "刷新报告" }));
  await screen.findByRole("alert"); download();
  expect(blobs).toHaveLength(1);
  expect(await text(blobs[0])).toContain("生成时间：2026-10-22T10:00:00");
  expect(requests).toEqual(["/api/tasks/7/report", "/api/tasks/7/report"]);
  expect(onGenerated).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert")).toHaveTextContent("仍显示上次取得的报告");
});

test("刷新在途时导出旧版，刷新成功后导出新版而不串用时间或内容", async () => {
  let finish!: (response: Response) => void; let count = 0;
  vi.stubGlobal("fetch", async () => ++count === 1 ? json(fixture()) : new Promise<Response>((resolve) => { finish = resolve; }));
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" onGenerated={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "生成审计报告" }));
  await screen.findByRole("heading", { name: "主张 1 · 虚构接口实现" });
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新报告" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "刷新报告" })); download();
  expect(blobs).toHaveLength(1);
  const oldText = await text(blobs[0]);
  expect(oldText).toContain("生成时间：2026-10-22T10:00:00"); expect(oldText).toContain("虚构接口实现");
  const updated = fixture(7, "新版接口结论"); updated.generated_at = "2026-10-23T11:22:33";
  await act(async () => finish(json(updated)));
  expect(screen.queryByText(/已发起下载/)).not.toBeInTheDocument();
  download();
  const updatedText = await text(blobs[1]);
  expect(updatedText).toContain("生成时间：2026-10-23T11:22:33"); expect(updatedText).toContain("新版接口结论");
  expect(updatedText).not.toContain("虚构接口实现"); expect(updatedText).not.toContain("2026-10-22T10:00:00");
  expect(count).toBe(2);
});

test.each(["create-url", "click"])("浏览器下载失败（%s）提示重试、保留报告和同步告警，不泄露异常详情", async (mode) => {
  if (mode === "create-url") vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error("sk-fictionalPrivate123"); });
  else vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error("sk-fictionalPrivate123"); });
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" state={state(fixture(), true)} onGenerated={vi.fn()} />);
  download();
  expect(screen.getAllByRole("alert").some((item) => item.textContent?.includes("未能发起下载"))).toBe(true);
  expect(screen.getByRole("heading", { name: "主张 1 · 虚构接口实现" })).toBeInTheDocument();
  expect(screen.getByText(/任务状态刷新失败/)).toBeInTheDocument();
  expect(screen.queryByText(/sk-fictionalPrivate123/)).not.toBeInTheDocument();
  expect(document.querySelector('a[download]')).not.toBeInTheDocument();
  if (mode === "click") await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-report"), { timeout: 2000 });
  else expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  download();
  expect(screen.getByRole("status")).toHaveTextContent("已发起下载");
  expect(screen.queryByText(/未能发起下载/)).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test("导出所有自由文本时处理常见密钥和本机路径，但保留正常相对路径与证据编号", async () => {
  const report = fixture(); const secret = 'sk-fictionalSecret123 C:\\Users\\Example\\private.txt token=fictionalValue';
  const claim = report.claim_reviews[0];
  for (const field of ["text", "resume_locator", "rationale", "gate_reason", "warning"] as const) claim[field] = secret;
  claim.suggestions = [secret];
  claim.evidence[0] = { ...claim.evidence[0], source_kind: "supplement", source_label: secret, locator: secret, excerpt: secret };
  report.jd_coverage = secret; report.jd_requirements[0] = { ...report.jd_requirements[0], text: secret, locator: secret, keywords: [secret], status: secret };
  report.next_steps = [secret]; report.conflicts = [secret];
  const before = JSON.stringify(report);
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" state={state(report)} onGenerated={vi.fn()} />);
  download(); expect(blobs).toHaveLength(1);
  const markdown = await text(blobs[0]);
  for (const value of ["fictionalSecret123", "Users", "private.txt", "fictionalValue"]) expect(markdown).not.toContain(value);
  for (const value of ["密钥已隐藏", "本机路径已隐藏", "敏感信息已隐藏", "src/app.py", "[E8]", "用户补充说明", "非独立证明", "分享前"]) expect(markdown).toContain(value);
  expect(JSON.stringify(report)).toBe(before);
});

test("引用代码完整保留缩进与换行，动态Markdown及HTML不能变成文档指令", async () => {
  const report = fixture();
  report.claim_reviews[0].text = '<img src="https://example.com/pixel">\n![tracking](https://example.com/pixel)';
  report.claim_reviews[0].evidence[0].excerpt = '第一行\n```python\n    return {"status": "ok"}\n```\n最后一行';
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" state={state(report)} onGenerated={vi.fn()} />);
  download(); expect(blobs).toHaveLength(1);
  const markdown = await text(blobs[0]);
  expect(markdown).toContain('&lt;img src="https://example.com/pixel"&gt;');
  expect(markdown).toContain('\\!\\[tracking\\]\\(https://example.com/pixel\\)');
  expect(markdown).toContain('````text\n第一行\n```python\n    return {"status": "ok"}\n```\n最后一行\n````');
  expect(markdown).not.toContain('<img');
});

test("切换报告时导出所属任务的当前内容，旧下载提示不带到新任务", async () => {
  const { rerender } = render(<ReportWorkspacePage taskId={7} auditStatus="completed" state={state(fixture())} onGenerated={vi.fn()} />);
  download(); expect(blobs).toHaveLength(1);
  rerender(<ReportWorkspacePage taskId={8} auditStatus="completed" state={state(fixture(8, "任务八报告"))} onGenerated={vi.fn()} />);
  expect(screen.queryByText(/已发起下载/)).not.toBeInTheDocument();
  download();
  expect(downloads[1].name).toBe("report-8.md");
  expect(await text(blobs[1])).toContain("任务八报告"); expect(await text(blobs[1])).not.toContain("虚构接口实现");
  expect(fetch).not.toHaveBeenCalled();
});

test("日期解析接受的附注仍作为文字导出，不成为Markdown图片", async () => {
  const report = fixture();
  report.generated_at = '2026-10-22 (\n![tracking](https://example.com/pixel)\n)';
  expect(isReport(report, 7)).toBe(true);
  render(<ReportWorkspacePage taskId={7} auditStatus="completed" state={state(report)} onGenerated={vi.fn()} />);
  download();
  const markdown = await text(blobs[0]);
  expect(markdown).toContain('\\!\\[tracking\\]\\(https://example.com/pixel\\)');
  expect(markdown).not.toContain('\n![tracking]');
});
