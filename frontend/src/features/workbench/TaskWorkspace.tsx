import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { MaterialsPage } from "../materials/MaterialsPage";
import { AuditWorkspacePage, type AuditOperation } from "../audit/AuditWorkspacePage";
import { InterviewWorkspace } from "../interview/InterviewWorkspace";
import { ReportWorkspacePage } from "../reports/ReportWorkspacePage";
import { WorkbenchShell, WorkspacePage } from "./WorkbenchShell";
import { TaskOverviewPage } from "./TaskOverviewPage";
import { isTaskSnapshot, TaskSnapshot } from "./types";

const activeTaskKey = "job-evidence.active-task-id";

function readActiveTaskId(): number | undefined {
  try {
    const value = localStorage.getItem(activeTaskKey);
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export function TaskWorkspace({ initialTaskId }: { initialTaskId?: number }) {
  const [taskId, setTaskId] = useState(() => initialTaskId ?? readActiveTaskId());
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [confirmedClaimCounts, setConfirmedClaimCounts] = useState<Record<number, number>>({});
  const [auditOperations, setAuditOperations] = useState<Record<number, AuditOperation | null>>({});
  const auditOperationsRef = useRef<Record<number, AuditOperation | null>>({});
  const updateAuditOperation = useCallback((id: number, value: AuditOperation | null, expectedId?: number) => {
    if (expectedId !== undefined && auditOperationsRef.current[id]?.id !== expectedId) return;
    auditOperationsRef.current = { ...auditOperationsRef.current, [id]: value };
    setAuditOperations(auditOperationsRef.current);
  }, []);
  const [activePage, setActivePage] = useState<WorkspacePage>("overview");
  const [loading, setLoading] = useState(Boolean(taskId));
  const [message, setMessage] = useState<string | null>(null);
  const [taskName, setTaskName] = useState("");
  const [creating, setCreating] = useState(false);
  const activeId = useRef(taskId);
  const [taskList, setTaskList] = useState<{ id: number; name: string; status: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const refreshTask = useCallback(async (taskId: number) => {
    const operationAtRead = auditOperationsRef.current[taskId];
    const response = await fetch(`/api/tasks/${taskId}`);
    if (!response.ok) throw new Error("无法读取任务状态");
    const next: unknown = await response.json();
    if (activeId.current !== taskId) return;
    if (!isTaskSnapshot(next) || next.id !== taskId) throw new Error("任务响应不匹配或结构不完整");
    if (auditOperationsRef.current[taskId]?.id !== operationAtRead?.id) throw new Error("审核操作已变化，请重新刷新");
    setSnapshot(next);
    if (operationAtRead?.phase !== "pending") updateAuditOperation(taskId, null, operationAtRead?.id);
    setMessage(null);
  }, [updateAuditOperation]);

  const loadTask = useCallback(async (id: number) => {
    setLoading(true);
    setMessage(null);
    try {
      await refreshTask(id);
    } catch {
      if (activeId.current === id) setMessage("无法读取任务状态，请确认服务已启动后重试。");
    } finally {
      if (activeId.current === id) setLoading(false);
    }
  }, [refreshTask]);

  useEffect(() => {
    if (!taskId) return;
    activeId.current = taskId;
    try {
      localStorage.setItem(activeTaskKey, String(taskId));
    } catch {
      // 浏览器禁用本地存储时，仍允许在当前页面使用任务。
    }
    void loadTask(taskId);
  }, [taskId, loadTask]);

  const openPicker = async () => {
    setPickerOpen(true); setPickerBusy(true); setPickerError(null);
    try {
      const response = await fetch("/api/tasks");
      if (!response.ok) throw new Error();
      const rows = await response.json() as { id: number; name: string; status: string }[];
      if (!Array.isArray(rows)) throw new Error();
      setTaskList(rows);
    } catch { setPickerError("任务列表读取失败，请重试；当前任务未改变。"); }
    finally { setPickerBusy(false); }
  };
  const taskControls = <section className="task-switcher">
    <p>{taskId ? `当前任务 #${taskId}` : "尚未选择任务"}</p>
    <button className="interview-button" type="button" disabled={pickerBusy} onClick={() => void openPicker()}>{pickerBusy ? "读取任务中…" : "切换任务"}</button>
    {pickerOpen && !pickerBusy && !pickerError ? <><label htmlFor="task-picker">选择任务</label><select id="task-picker" value={taskId ?? ""} onChange={(event) => {
      const id = Number(event.target.value);
      if (!id || id === taskId) return;
      activeId.current = id; setSnapshot(null); setLoading(true); setMessage(null); setTaskId(id); setActivePage("overview"); setPickerOpen(false);
    }}><option value="" disabled>请选择已有任务</option>{taskList.map((task) => <option key={task.id} value={task.id}>#{task.id} · {task.name}</option>)}</select>{!taskList.length ? <p>暂无已有任务</p> : null}</> : null}
    {pickerError ? <p role="alert">{pickerError}</p> : null}
  </section>;

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setCreating(true);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: taskName }),
      });
      if (!response.ok) throw new Error("创建任务失败，请检查任务名称后重试");
      const created = (await response.json()) as { id: number };
      setLoading(true);
      setTaskId(created.id);
      setActivePage("materials");
    } catch {
      setMessage("创建任务失败，请检查连接和任务名称后重试。");
    } finally {
      setCreating(false);
    }
  };

  if (loading && !snapshot) return <main className="workspace"><p role="status">正在读取任务状态…</p></main>;
  if (!snapshot && taskId) {
    return <main className="workspace"><section className="panel task-create-panel">
      <h1>恢复求职任务</h1>
      <p role="alert">{message}</p>
      {taskControls}
      <button className="primary-button" type="button" onClick={() => void loadTask(taskId)}>重试读取任务</button>
      <button type="button" onClick={() => {
        try { localStorage.removeItem(activeTaskKey); } catch { /* 本地存储可能不可用。 */ }
        activeId.current = undefined;
        setTaskId(undefined);
        setMessage(null);
        setActivePage("overview");
      }}>新建其他任务（保留原任务数据）</button>
    </section></main>;
  }
  if (!snapshot) {
    return (
      <WorkbenchShell taskControls={taskControls} activePage="overview" onNavigate={() => undefined} lockedPages={{ materials: "创建任务后可导入材料", audit: "创建任务后可开始审核", report: "完成审核后可生成", interview: "完成审核并生成报告后可开始" }}>
        <header className="page-header"><p className="eyebrow">开始使用</p><h1>新建求职任务</h1><p>创建一个任务后，再导入简历、岗位描述和项目材料。</p></header>
        <section className="panel task-create-panel">
          <h2>任务信息</h2>
          <form onSubmit={createTask}>
            <label htmlFor="task-name">任务名称</label>
            <input id="task-name" value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="例如：AI 应用开发岗位" required />
            <button className="primary-button" type="submit" disabled={creating}>{creating ? "正在创建…" : "创建任务"}</button>
          </form>
          {message ? <p role="alert">{message}</p> : null}
        </section>
      </WorkbenchShell>
    );
  }

  const lockedPages = {
    ...(snapshot.audit.status === "completed" ? {} : { report: "完成审核后可生成" }),
    ...(snapshot.report_ready ? {} : { interview: snapshot.audit.status === "completed" ? "生成报告后可开始" : "完成审核并生成报告后可开始" }),
  };

  return (
    <WorkbenchShell taskControls={taskControls} activePage={activePage} lockedPages={lockedPages} onNavigate={setActivePage}>
      {message ? <div className="panel"><p role="alert">{message}</p><button type="button" disabled={loading} onClick={() => void loadTask(snapshot.id)}>{loading ? "正在重试…" : "重试读取任务"}</button></div> : null}
      {activePage === "materials" ? <MaterialsPage taskId={snapshot.id} sources={snapshot.sources} claimCount={Math.max(snapshot.claims.length, confirmedClaimCounts[snapshot.id] ?? 0)} needsClaimRefresh={(confirmedClaimCounts[snapshot.id] ?? 0) > snapshot.claims.length} onClaimsGenerated={(count) => setConfirmedClaimCounts((previous) => ({ ...previous, [snapshot.id]: count }))} onReview={() => setActivePage("audit")} onChanged={() => refreshTask(snapshot.id)} /> : null}
      {activePage === "overview" ? <TaskOverviewPage snapshot={snapshot} onNavigate={setActivePage} /> : null}
      {activePage === "audit" ? <AuditWorkspacePage key={snapshot.id} snapshot={snapshot} operation={auditOperations[snapshot.id] ?? null} onOperationChange={(value, expectedId) => updateAuditOperation(snapshot.id, value, expectedId)} onChanged={() => refreshTask(snapshot.id)} /> : null}
      {activePage === "report" ? <ReportWorkspacePage taskId={snapshot.id} auditStatus={snapshot.audit.status} onGenerated={() => refreshTask(snapshot.id)} /> : null}
      {activePage === "interview" ? <InterviewWorkspace taskId={snapshot.id} reportReady={snapshot.report_ready} onChanged={() => refreshTask(snapshot.id)} /> : null}
    </WorkbenchShell>
  );
}
