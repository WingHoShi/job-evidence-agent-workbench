import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AuditWorkspacePage } from "./AuditWorkspacePage";
import { TaskSnapshot } from "../workbench/types";

const snapshot: TaskSnapshot = {
  id: 7,
  name: "AI 应用开发岗位",
  status: "draft",
  sources: [],
  claims: [{ id: 1, text: "使用 FastAPI 提供服务", resume_locator: "简历:1", capability_tags: ["后端"], status: "pending_review" }],
  assessments: { "1": { claim_id: 1, links: [], verdict: "partial", rationale: "项目材料存在相关服务说明。" } },
  gates: { "1": { eligible: false, requires_review: true, reason: "证据不足，需要补充或人工确认" } },
  report_ready: false,
  audit: { status: "awaiting_review", claim_id: 1, events: [], recoverable: true },
};

const missingResults: Pick<TaskSnapshot, "assessments" | "gates">[] = [
  { assessments: {}, gates: {} },
  { assessments: snapshot.assessments, gates: {} },
  { assessments: {}, gates: { "1": { eligible: true, requires_review: false, reason: "支持充分" } } },
];
const auditResponse = { status: "awaiting_review", claim_id: 1, events: [] };
const assessmentResponse = { assessment: snapshot.assessments["1"], gate: snapshot.gates["1"], evidence: [] };

test.each(missingResults)("判定或门禁缺失时风险显示待评估而非低风险 %#", (missingResult) => {
  render(<AuditWorkspacePage snapshot={{ ...snapshot, ...missingResult }} onChanged={vi.fn()} />);

  const row = screen.getByRole("row", { name: /使用 FastAPI 提供服务/ });
  expect(within(row).getAllByRole("cell")[3]).toHaveTextContent("待评估");
});

test("完整判定到达后更新风险显示", () => {
  const view = render(<AuditWorkspacePage snapshot={{ ...snapshot, assessments: {}, gates: {} }} onChanged={vi.fn()} />);
  const riskCell = () => within(screen.getByRole("row", { name: /使用 FastAPI 提供服务/ })).getAllByRole("cell")[3];
  expect(riskCell()).toHaveTextContent("待评估");

  view.rerender(<AuditWorkspacePage snapshot={snapshot} onChanged={vi.fn()} />);
  expect(riskCell()).toHaveTextContent("需关注");

  view.rerender(<AuditWorkspacePage snapshot={{ ...snapshot,
    assessments: { "1": { ...snapshot.assessments["1"], verdict: "strong" } },
    gates: { "1": { eligible: true, requires_review: false, reason: "支持充分" } },
  }} onChanged={vi.fn()} />);
  expect(riskCell()).toHaveTextContent("低");
});

test("选择主张后展示详情、审核提示和审核操作", () => {
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={vi.fn()} />);

  fireEvent.click(screen.getByRole("row", { name: /使用 FastAPI 提供服务/ }));

  expect(screen.getByRole("heading", { name: "主张详情" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "证据数量" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "审核提示" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "接受主张" })).toBeInTheDocument();
});

test("长证据默认折叠，风险与审核操作在原文之前且仍需确认风险", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    ...assessmentResponse,
    evidence: [{ id: 11, locator: "health-service/README.md:1", text: "这是用于核验的长证据。".repeat(40) }],
  }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "重新判定当前主张" }));
  await screen.findByText("候选证据判定已完成");
  const original = screen.getByText("这是用于核验的长证据。".repeat(40));
  const disclosure = original.closest("details");
  expect(disclosure).not.toBeNull();
  expect(disclosure).not.toHaveAttribute("open");
  const accept = screen.getByRole("button", { name: "接受主张" });
  expect(accept.compareDocumentPosition(original) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("证据不足，需要补充或人工确认")).toBeVisible();
  fireEvent.click(accept);
  expect(screen.getByRole("dialog", { name: "确认接受风险主张" })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("列表分别显示总数与待审核数，不把已审核主张算作待审核", () => {
  render(<AuditWorkspacePage snapshot={{ ...snapshot, claims: [
    snapshot.claims[0],
    { ...snapshot.claims[0], id: 2, text: "已确认的主张", status: "confirmed" },
    { ...snapshot.claims[0], id: 3, text: "已拒绝的主张", status: "rejected" },
  ] }} onChanged={vi.fn()} />);
  expect(screen.getByText("共 3 条 · 待审核 1 条")).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(4);
});

test("已有判定的当前待审核主张可手动重新判定，不自动发送请求", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => assessmentResponse });
  vi.stubGlobal("fetch", fetchMock);
  const onChanged = vi.fn();
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={onChanged} />);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重新判定当前主张" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("候选证据判定已完成"));
  expect(screen.getByText("已检索，没有可核验的候选证据")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/tasks/7/claims/1/assessment", { method: "POST" });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("拒绝主张需要确认，提交失败后保留可理解提示", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ detail: "审核保存失败，请重试" }),
  }));
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "拒绝主张" }));
  expect(screen.getByRole("dialog", { name: "确认拒绝主张" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("审核保存失败，请重试");
});

test("未开始审核时保留长列表并提供开始操作", () => {
  const claims = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    text: `能力主张 ${index + 1}`,
    resume_locator: `简历:${index + 1}`,
    capability_tags: [],
    status: "pending_review",
  }));
  render(<AuditWorkspacePage snapshot={{ ...snapshot, claims, assessments: {}, gates: {}, audit: { status: "created", claim_id: null, events: [], recoverable: false } }} onChanged={vi.fn()} />);

  expect(screen.getAllByRole("row")).toHaveLength(13);
  expect(screen.getByRole("button", { name: "开始逐条审核" })).toBeInTheDocument();
});

test("风险接受必须确认，取消不提交，确认请求绑定当前主张", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => auditResponse });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={vi.fn()} />);
  const decisions = screen.getByRole("group", { name: "人工审核" });
  expect(within(decisions).getByRole("button", { name: "拒绝主张" })).toBeInTheDocument();
  fireEvent.click(within(decisions).getByRole("button", { name: "接受主张" }));
  expect(screen.getByRole("dialog", { name: "确认接受风险主张" })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "接受主张" }));
  fireEvent.click(screen.getByRole("button", { name: "确认风险并接受" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("审核结果已保存"));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ decision: "accepted", claim_id: 1, risk_acknowledged: true });
});

test("撤销需确认，失败保留原审核状态并可重试", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ detail: "撤销暂时失败" }) }).mockResolvedValueOnce({ ok: true, json: async () => auditResponse });
  vi.stubGlobal("fetch", fetchMock);
  const onChanged = vi.fn();
  render(<AuditWorkspacePage snapshot={{ ...snapshot, claims: [{ ...snapshot.claims[0], status: "confirmed" }], audit: { ...snapshot.audit, status: "completed", claim_id: null } }} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "撤销审核，返回待审核" }));
  expect(screen.getByRole("dialog", { name: "确认撤销审核" })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("撤销暂时失败");
  expect(screen.getByText("已接受")).toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已撤销审核，返回待审核"));
  expect(fetchMock).toHaveBeenLastCalledWith("/api/tasks/7/claims/1/undo-review", { method: "POST" });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("已生成报告时禁止在页面撤销审核", () => {
  render(<AuditWorkspacePage snapshot={{ ...snapshot, report_ready: true, claims: [{ ...snapshot.claims[0], status: "confirmed" }] }} onChanged={vi.fn()} />);
  expect(screen.getByRole("button", { name: "撤销审核，返回待审核" })).toBeDisabled();
});

test("补证表单按需展开，收起后保留草稿且提交仍绑定当前主张", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => auditResponse });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={vi.fn()} />);
  expect(screen.queryByRole("textbox", { name: "补充说明" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "补充证据" }));
  fireEvent.change(screen.getByRole("textbox", { name: "补充说明" }), { target: { value: "补充一份虚构运行记录" } });
  fireEvent.click(screen.getByRole("button", { name: "收起补充证据" }));
  expect(screen.queryByRole("textbox", { name: "补充说明" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "补充证据" }));
  expect(screen.getByRole("textbox", { name: "补充说明" })).toHaveValue("补充一份虚构运行记录");
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保存补充证据" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("补充证据已保存"));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ decision: "supplement", claim_id: 1, risk_acknowledged: false, supplemental_text: "补充一份虚构运行记录" });
});

test("确认弹窗聚焦取消按钮，限制键盘焦点并支持 Escape 安全关闭", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<AuditWorkspacePage snapshot={snapshot} onChanged={vi.fn()} />);
  const reject = screen.getByRole("button", { name: "拒绝主张" });
  reject.focus();
  fireEvent.click(reject);
  const dialog = screen.getByRole("dialog", { name: "确认拒绝主张" });
  const cancel = within(dialog).getByRole("button", { name: "取消" });
  const confirm = within(dialog).getByRole("button", { name: "确认拒绝" });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
  expect(confirm).toHaveFocus();
  fireEvent.keyDown(confirm, { key: "Tab" });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(reject).toHaveFocus();
  expect(fetchMock).not.toHaveBeenCalled();
});
