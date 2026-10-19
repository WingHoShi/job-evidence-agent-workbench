import { FormEvent, useRef, useState } from "react";
import { InterviewSession, getInterview, listInterviews, requestKey, removeLocal, startInterview } from "./interviewApi";

export function InterviewSetup({ taskId, onStarted }: { taskId: number; onStarted: (session: InterviewSession) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const [questionCount, setQuestionCount] = useState(5);
  const [durationMinutes, setDurationMinutes] = useState(20);
  const [focusAreas, setFocusAreas] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const refresh = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const rows = await listInterviews(taskId);
      const active = rows.find((row) => row.version === 2 && row.status !== "completed");
      if (active) {
        const result = await getInterview(active.id);
        if (result.task_id !== taskId) throw new Error("会话与当前任务不符");
        removeLocal(`interview-start:${taskId}`); onStarted(result);
      } else { removeLocal(`interview-start:${taskId}`); setMessage(null); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "状态刷新失败"); }
    finally { lock.current = false; setBusy(false); }
  };

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(null);
    const storageKey = `interview-start:${taskId}`;
    try {
      const options = { mode: advanced ? "advanced" as const : "default" as const, question_count: advanced ? questionCount : 5, duration_minutes: advanced ? durationMinutes : null, focus_areas: advanced ? focusAreas.split(/[,，]/).map((item) => item.trim()).filter(Boolean) : [] };
      if (options.focus_areas.length > 5 || options.focus_areas.some((item) => item.length > 100)) throw new Error("侧重点最多 5 项，每项最多 100 字");
      const result = await startInterview(taskId, options, requestKey(storageKey, JSON.stringify(options)));
      removeLocal(storageKey);
      onStarted(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "开始失败，请刷新状态后重试"); }
    finally { lock.current = false; setBusy(false); }
  };

  return <section className="panel interview-setup">
    <p className="eyebrow">面试准备</p><h2>开始文字模拟面试</h2>
    <p className="interview-setup-intro">围绕人工接受的主张与岗位要求练习，默认综合模式为 5 题（含追问）。</p>
    <div className="interview-setup-plan" role="group" aria-label={advanced ? "自定义练习安排" : "默认练习安排"}>
      <div><span>练习题数</span><strong>{advanced ? questionCount : 5} 题（含追问）</strong></div>
      <div><span>作答节奏</span><strong>{advanced ? `预计 ${durationMinutes} 分钟（仅参考）` : "按你的节奏作答"}</strong></div>
      <div><span>反馈方式</span><strong>整轮结束后复盘</strong></div>
    </div>
    <p className="interview-setup-guidance">一次只问一题，回答后继续追问；面试中不评分、不提示答案。题数有限，不保证覆盖全部主张，人工接受也不等于证据充分。</p>
    <form onSubmit={start}>
      <label className="interview-checkbox"><input type="checkbox" checked={advanced} disabled={busy} onChange={(event) => setAdvanced(event.target.checked)} /> 使用高级设置</label>
      {advanced ? <fieldset disabled={busy}><legend>高级设置</legend><div className="interview-form-grid"><label>题数<input type="number" min="1" max="10" required value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} /></label><label>预计时长（分钟，仅参考）<input type="number" min="5" max="120" required value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} /></label></div><label>侧重点（用逗号分隔）<input value={focusAreas} onChange={(event) => setFocusAreas(event.target.value)} placeholder="例如：后端，项目，测试" /></label></fieldset> : null}
      {message ? <div className="interview-error" role="alert"><p>{message}</p><button className="interview-button" type="button" disabled={busy} onClick={() => void refresh()}>刷新开始状态</button></div> : null}
      <div className="interview-setup-footer"><p className="muted-copy">正常完成 N 题约需 N 次出题调用 + 1 次复盘调用；异常修正或手动重试可能增加费用。</p><button className="interview-button is-primary" type="submit" disabled={busy}>{busy ? "正在准备首题…" : "开始面试"}</button></div>
    </form>
  </section>;
}
