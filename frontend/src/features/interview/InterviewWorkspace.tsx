import { useEffect, useState } from "react";
import { InterviewPage, SavedAnswerDrafts } from "./InterviewPage";
import { InterviewSetup } from "./InterviewSetup";
import { InterviewReviewPage } from "./InterviewReviewPage";
import { InterviewSession, InterviewSummary, LegacyInterview, getInterview, getLegacyInterview, listInterviews, removeLocal } from "./interviewApi";

export function InterviewWorkspace(props: { taskId: number; reportReady: boolean; onChanged: () => void | Promise<void> }) {
  return <InterviewWorkspaceContent key={props.taskId} {...props} />;
}

function InterviewWorkspaceContent({ taskId, reportReady, onChanged }: { taskId: number; reportReady: boolean; onChanged: () => void | Promise<void> }) {
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [history, setHistory] = useState<InterviewSummary[]>([]);
  const [legacy, setLegacy] = useState<LegacyInterview | null>(null);
  const [loading, setLoading] = useState(reportReady);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!reportReady) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError(null);
    void (async () => {
      try {
        const rows = await listInterviews(taskId, controller.signal);
        if (!active) return;
        setHistory(rows);
        const current = rows.find((item) => item.version === 2 && item.status !== "completed") ?? rows.find((item) => item.version === 2);
        if (current) {
          const result = await getInterview(current.id, controller.signal);
          if (!active) return;
          if (result.task_id !== taskId) throw new Error("会话与当前任务不符");
          setSession(result); removeLocal(`interview-start:${taskId}`);
        } else setSession(null);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "加载面试失败"); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [taskId, reportReady, reload]);

  const changed = (value: InterviewSession) => {
    if (value.task_id !== taskId) { setError("会话与当前任务不符"); return; }
    setSession(value);
    setHistory((rows) => [{ id: value.id, task_id: taskId, version: 2, status: value.status, question_count: value.question_count }, ...rows.filter((item) => item.version !== 2 || item.id !== value.id)]);
  };
  const openHistory = async (item: InterviewSummary) => {
    setError(null); setLoading(true);
    try {
      if (item.version === 1) {
        const result = await getLegacyInterview(item.id);
        if (result.session.task_id !== taskId) throw new Error("历史会话与任务不符");
        setLegacy(result);
      } else { changed(await getInterview(item.id)); setLegacy(null); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "加载历史失败"); }
    finally { setLoading(false); }
  };

  return <section className="interview-workspace">
    <header className="page-header"><p className="eyebrow">当前阶段</p><h1>模拟面试</h1><p>围绕项目与岗位，一次一题地练习；整轮结束后再看复盘。</p></header>
    {!reportReady ? <section className="panel action-panel"><h2>面试尚未解锁</h2><p>生成审计报告后可开始模拟面试</p></section> : <>
      {loading ? <p role="status" className="interview-note">正在恢复面试状态…</p> : null}
      {error ? <div className="interview-error" role="alert">{error}<button className="interview-button" type="button" onClick={() => setReload((value) => value + 1)}>重新加载面试</button></div> : null}
      {!loading && !error ? legacy ? <section className="panel interview-legacy"><h2>旧版模板面试</h2><p className="interview-note">旧版未保存复盘，无法恢复；历史仅供查看，不会自动重新生成。</p>{legacy.turns.map((turn) => <article key={turn.id}><h3>{turn.question}</h3><p>{turn.answer ?? "未回答"}</p></article>)}<button className="interview-button" type="button" onClick={() => setLegacy(null)}>返回新版面试</button></section> : session ? session.status === "completed" && session.review ? <><SavedAnswerDrafts session={session} /><InterviewReviewPage review={session.review} onRestart={() => setSession(null)} /></> : <InterviewPage key={session.id} session={session} onSessionChanged={changed} /> : <InterviewSetup taskId={taskId} onStarted={(value) => { changed(value); void Promise.resolve(onChanged()).catch(() => setError("面试已保存，任务概览刷新失败，请重新加载")); }} /> : null}
      {!loading && history.length > 0 ? <details className="panel interview-sessions"><summary>历史面试 · {history.length} 轮</summary><div>{history.map((item) => <button className="interview-button" key={`${item.version}:${item.id}`} type="button" onClick={() => void openHistory(item)}>{item.version === 1 ? "查看旧版模板面试" : item.status === "completed" ? "查看复盘" : "继续面试"} #{item.id}</button>)}</div></details> : null}
    </>}
  </section>;
}
