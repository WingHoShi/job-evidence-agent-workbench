import { FormEvent, useEffect, useRef, useState } from "react";
import { InterviewSession, finishInterview, getInterview, readLocal, removeLocal, requestKey, retryOperation, submitAnswer, writeLocal } from "./interviewApi";

export function InterviewPage({ session, onSessionChanged }: { session: InterviewSession; onSessionChanged: (session: InterviewSession) => void }) {
  const current = session.status === "awaiting_answer" ? session.turns.find((turn) => turn.answer === null) : null;
  const draftKey = `interview-draft:${session.task_id}:${session.id}:${current?.id ?? "none"}`;
  const [answer, setAnswer] = useState(() => readLocal(draftKey) ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setAnswer(readLocal(draftKey) ?? ""); }, [draftKey]);
  const operation = session.operation;
  const generating = ["preparing", "generating_question", "generating_review"].includes(session.status);
  const running = generating && operation?.state === "running" && !operation.retry_allowed;

  const act = async (operation: () => Promise<InterviewSession>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(null);
    try {
      const result = await operation();
      if (result.task_id !== session.task_id || result.id !== session.id) throw new Error("返回会话不一致，请刷新状态");
      if (mounted.current) { setConfirm(false); onSessionChanged(result); }
    } catch (reason) { if (mounted.current) setMessage(reason instanceof Error ? reason.message : "操作失败，请刷新状态后重试"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!current || !answer.trim() || answer.length > 2000) return;
    void act(async () => {
      const key = `interview-answer:${session.id}:${current.id}`;
      const result = await submitAnswer(session.id, current.id, answer.trim(), requestKey(key, answer.trim()));
      const saved = result.turns.find((turn) => turn.id === current.id);
      if (!saved || saved.answer !== answer.trim() || result.id !== session.id || result.task_id !== session.task_id) throw new Error("响应未确认本页回答已保存，请刷新状态后重试；草稿仍保留。");
      removeLocal(draftKey); removeLocal(key);
      return result;
    });
  };
  const finish = () => void act(() => finishInterview(session.id, requestKey(`interview-finish:${session.id}`, "finish")));
  const refresh = () => void act(async () => {
    const result = await getInterview(session.id);
    if (result.id === session.id && result.task_id === session.task_id && current && result.turns.some((turn) => turn.id === current.id && turn.answer === null) && result.status === "awaiting_answer") removeLocal(`interview-answer:${session.id}:${current.id}`);
    return result;
  });
  const answered = session.turns.filter((turn) => turn.answer !== null).length;

  return <div className="interview-layout">
    <section className="panel interview-main">
      <div className="interview-progress"><span className="eyebrow">{current ? `第 ${current.ordinal} / ${session.question_count} 题` : `已回答 ${answered} / ${session.question_count} 题`}</span><span>{current?.kind === "followup" ? "深入追问" : "文字模拟面试"}</span></div>
      <progress max={session.question_count} value={answered} aria-label="面试进度" />
      <SavedAnswerDrafts session={session} />
      {current ? <><div className="interview-question"><span className="muted-copy">当前主题 · 主张 {current.claim_id}</span><h2>{current.question}</h2></div>
        <form onSubmit={submit}><label htmlFor="interview-answer">当前回答</label><textarea id="interview-answer" rows={8} value={answer} maxLength={2000} disabled={busy} onChange={(event) => { setAnswer(event.target.value); writeLocal(draftKey, event.target.value); }} placeholder="像真实面试一样回答，说明你实际做过的内容。" required /><span className="interview-character-count">{answer.length} / 2000</span>
          <button className="interview-button is-primary" disabled={busy || !answer.trim()} type="submit">{busy ? "提交中…" : "提交回答"}</button></form></> : session.status === "ready_to_finish" ? <div className="interview-note"><h2>本轮作答完成</h2><p>已完成设定题数，可以结束面试并生成整轮复盘。</p></div> : <div className={operation?.state === "failed" ? "interview-error" : "interview-note"} role={operation?.state === "failed" ? "alert" : "status"}><h2>{session.status === "generating_review" ? "正在准备整轮复盘" : session.status === "preparing" ? "正在准备首题" : "回答已保存，正在准备下一题"}</h2><p>{operation?.safe_error ?? "生成结果保存在本机。若请求中断，可刷新状态继续。"}</p><p className="muted-copy">重试可能产生额外 API 费用，超时不能保证服务商未计费。</p>
          {operation && (operation.retry_allowed || operation.state === "pending") ? <button className="interview-button is-primary" disabled={busy} onClick={() => void act(() => retryOperation(session.id, operation.id))}>重试生成（可能计费）</button> : null}</div>}
      {message ? <p className="interview-error" role="alert">{message}</p> : null}
      <div className="interview-footer"><button className="interview-button" disabled={busy} onClick={refresh}>刷新状态</button><button className="interview-button" disabled={busy || running || session.status === "generating_review"} onClick={() => session.status === "ready_to_finish" ? finish() : setConfirm(true)}>结束面试并生成复盘</button></div>
      {session.context_truncated ? <p className="muted-copy">本轮部分材料已按输入预算缩减，复盘会保留此提示。</p> : null}
    </section>
    <aside className="panel interview-history"><h2>问答记录</h2><p className="muted-copy">面试中不评分、不提示答案。已提交回答会保存在本机。</p><details><summary>问答历史 · {session.turns.length} 题</summary>{session.turns.map((turn) => <article key={turn.id}><span className="eyebrow">第 {turn.ordinal} 题 · {turn.kind === "followup" ? "追问" : "主问题"}</span><h3>{turn.question}</h3><p>{turn.answer ?? "待回答"}</p></article>)}</details><p className="muted-copy">预计时长：{session.duration_minutes ? `${session.duration_minutes} 分钟（仅参考）` : "按你的节奏作答"}</p></aside>
    {confirm ? <FinishDialog busy={busy} error={message} onCancel={() => setConfirm(false)} onConfirm={finish} /> : null}
  </div>;
}

export function SavedAnswerDrafts({ session }: { session: InterviewSession }) {
  const conflicts = session.turns.flatMap((turn) => {
    const draft = readLocal(`interview-draft:${session.task_id}:${session.id}:${turn.id}`);
    return turn.answer !== null && draft?.trim() && draft.trim() !== turn.answer ? [{ turn, draft }] : [];
  });
  useEffect(() => {
    for (const turn of session.turns) if (turn.answer !== null) {
      const key = `interview-draft:${session.task_id}:${session.id}:${turn.id}`;
      const draft = readLocal(key);
      if (draft?.trim() === turn.answer) { removeLocal(key); removeLocal(`interview-answer:${session.id}:${turn.id}`); }
    }
  }, [session]);
  return <>{conflicts.map(({ turn, draft }) => <details className="interview-note" key={turn.id} open><summary>第 {turn.ordinal} 题：服务端已保存不同回答，本页草稿保留</summary><p>以下文本未被提交，不会进入复盘。可选中复制保存。</p><p className="interview-answer-quote">{draft}</p></details>)}</>;
}

function FinishDialog({ busy, error, onCancel, onConfirm }: { busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { const prior = document.activeElement as HTMLElement | null; cancel.current?.focus(); return () => prior?.focus(); }, []);
  return <div className="interview-modal-backdrop"><section className="interview-modal-card" role="dialog" aria-modal="true" aria-labelledby="interview-finish-title" aria-describedby="interview-finish-description" onKeyDown={(event) => {
    if (event.key === "Escape" && !busy) onCancel();
    if (event.key === "Tab") { event.preventDefault(); if (!busy) (document.activeElement === cancel.current ? confirm.current : cancel.current)?.focus(); }
  }}><p className="eyebrow">结束确认</p><h2 id="interview-finish-title">提前结束本轮面试？</h2><p id="interview-finish-description">复盘会标记为部分完成。尚未提交的草稿不会进入复盘；没有回答时不调用模型。</p>{error ? <p role="alert" className="interview-error">{error}</p> : null}<div className="interview-footer"><button ref={cancel} className="interview-button" disabled={busy} onClick={onCancel}>继续作答</button><button ref={confirm} className="interview-button is-primary" disabled={busy} onClick={onConfirm}>{busy ? "生成中…" : "确认结束"}</button></div></section></div>;
}
