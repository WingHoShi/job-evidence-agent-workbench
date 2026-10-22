import { useEffect, useRef, useState } from "react";
import { InterviewPage, SavedAnswerDrafts } from "./InterviewPage";
import { InterviewSetup } from "./InterviewSetup";
import { InterviewReviewPage } from "./InterviewReviewPage";
import { InterviewSession, InterviewSummary, LegacyInterview, getInterview, getLegacyInterview, listInterviews, removeLocal } from "./interviewApi";

const sessionStatusLabels: Record<string, string> = {
  preparing: "首题待准备", awaiting_answer: "等待作答", generating_question: "下一题待生成",
  ready_to_finish: "作答已完成", generating_review: "复盘待完成", completed: "已完成",
};

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
  const [historyLoad, setHistoryLoad] = useState<{ item: InterviewSummary; failed: boolean } | null>(null);
  const historyRequest = useRef<{ item: InterviewSummary; controller: AbortController } | null>(null);
  const cancelHistory = () => {
    historyRequest.current?.controller.abort(); historyRequest.current = null; setHistoryLoad(null);
  };
  useEffect(() => {
    cancelHistory();
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
    return () => { active = false; controller.abort(); historyRequest.current?.controller.abort(); historyRequest.current = null; };
  }, [taskId, reportReady, reload]);

  const changed = (value: InterviewSession) => {
    if (value.task_id !== taskId) { setError("会话与当前任务不符"); return; }
    cancelHistory();
    setSession(value);
    setHistory((rows) => [{ id: value.id, task_id: taskId, version: 2, status: value.status, question_count: value.question_count }, ...rows.filter((item) => item.version !== 2 || item.id !== value.id)]);
  };
  const openHistory = async (item: InterviewSummary) => {
    const previous = historyRequest.current;
    if (previous?.item.id === item.id && previous.item.version === item.version) return;
    previous?.controller.abort();
    const request = { item, controller: new AbortController() };
    historyRequest.current = request;
    setHistoryLoad({ item, failed: false });
    const active = () => historyRequest.current === request && !request.controller.signal.aborted;
    try {
      if (item.version === 1) {
        const result = await getLegacyInterview(item.id, request.controller.signal);
        if (!active()) return;
        if (result.session?.task_id !== taskId || result.session.id !== item.id || !Array.isArray(result.turns)) throw new Error("历史会话与任务不符");
        setError(null);
        setLegacy(result);
        cancelHistory();
      } else {
        const result = await getInterview(item.id, request.controller.signal);
        if (!active()) return;
        if (result.task_id !== taskId || result.id !== item.id) throw new Error("历史会话与任务不符");
        setError(null);
        changed(result); setLegacy(null);
      }
    } catch {
      if (active()) setHistoryLoad({ item, failed: true });
    } finally { if (historyRequest.current === request) historyRequest.current = null; }
  };

  return <section className="interview-workspace">
    <header className="page-header"><p className="eyebrow">当前阶段</p><h1>模拟面试</h1><p>围绕项目与岗位，一次一题地练习；整轮结束后再看复盘。</p></header>
    {!reportReady ? <section className="panel action-panel"><h2>面试尚未解锁</h2><p>生成审计报告后可开始模拟面试</p></section> : <>
      {loading ? <p role="status" className="interview-note">正在恢复面试状态…</p> : null}
      {error ? <div className="interview-error" role="alert">{error}<button className="interview-button" type="button" onClick={() => setReload((value) => value + 1)}>重新加载面试</button></div> : null}
      {historyLoad ? historyLoad.failed ? <div className="interview-error" role="alert">未能打开会话 #{historyLoad.item.id}；当前会话和草稿已保留。<button className="interview-button" type="button" onClick={() => void openHistory(historyLoad.item)}>重试打开会话 #{historyLoad.item.id}</button></div> : <p className="interview-note" role="status">正在打开会话 #{historyLoad.item.id}，当前内容保留。</p> : null}
      {!loading && !error ? legacy ? <section className="panel interview-legacy"><h2>旧版模板面试</h2><p className="interview-note">旧版未保存复盘，无法恢复；历史仅供查看，不会自动重新生成。</p>{legacy.turns.map((turn) => <article key={turn.id}><h3>{turn.question}</h3><p>{turn.answer ?? "未回答"}</p></article>)}<button className="interview-button" type="button" onClick={() => { cancelHistory(); setLegacy(null); }}>返回新版面试</button></section> : session ? session.status === "completed" && session.review ? <><SavedAnswerDrafts session={session} /><InterviewReviewPage review={session.review} onRestart={() => { cancelHistory(); setSession(null); }} /></> : <InterviewPage key={session.id} session={session} onSessionChanged={changed} /> : <InterviewSetup taskId={taskId} onStarted={(value) => { changed(value); void Promise.resolve(onChanged()).catch(() => setError("面试已保存，任务概览刷新失败，请重新加载")); }} /> : null}
      {!loading && history.length > 0 ? <details className="panel interview-sessions"><summary>历史面试 · {history.length} 轮</summary><ul className="interview-session-list" aria-label="历史面试列表">{history.map((item) => {
        const action = item.version === 1 ? "查看旧版模板面试" : item.status === "completed" ? "查看复盘" : "继续面试";
        return <li key={`${item.version}:${item.id}`}><div className="interview-session-info"><strong>会话 #{item.id}</strong><span className="muted-copy">设定 {item.question_count} 题</span><span className="interview-session-status">{item.version === 1 ? "旧版记录" : sessionStatusLabels[item.status] ?? "状态待确认"}</span></div><button className="interview-button" aria-label={`${action} #${item.id}`} type="button" onClick={() => void openHistory(item)}>{action}</button></li>;
      })}</ul></details> : null}
    </>}
  </section>;
}
