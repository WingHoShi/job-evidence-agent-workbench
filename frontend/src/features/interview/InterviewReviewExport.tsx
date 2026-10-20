import { useState } from "react";
import type { InterviewReview } from "./interviewApi";
import { reviewMarkdown } from "./reviewMarkdown";

export function InterviewReviewExport({ review, onRestart }: { review: InterviewReview; onRestart?: () => void }) {
  const [open, setOpen] = useState(false);
  const [includeOriginals, setIncludeOriginals] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const download = () => {
    let url: string | undefined;
    const anchor = document.createElement("a");
    try {
      const now = new Date().toISOString();
      const documentText = reviewMarkdown(review, includeOriginals, now);
      url = URL.createObjectURL(new Blob([documentText], { type: "text/markdown;charset=utf-8" }));
      anchor.href = url;
      anchor.download = `interview-review-${now.replace(/[:.]/g, "-")}.md`;
      anchor.hidden = true; document.body.appendChild(anchor); anchor.click();
      setMessage({ text: "已发起下载，请在浏览器下载列表中确认文件。", error: false });
    } catch {
      setMessage({ text: "未能发起下载，请检查浏览器下载权限后重试；原复盘未改变。", error: true });
    } finally {
      anchor.remove();
      // Let the browser start reading the object URL before releasing it.
      if (url) { const created = url; const revoke = URL.revokeObjectURL.bind(URL); window.setTimeout(() => revoke(created), 1000); }
    }
  };
  return <div className="interview-export">
    <div className="interview-review-actions">
      {onRestart ? <button className="interview-button is-primary" type="button" onClick={onRestart}>再练一轮</button> : null}
      <button className="interview-button" type="button" aria-expanded={open} onClick={() => { setOpen(!open); setIncludeOriginals(false); setMessage(null); }}>导出复盘</button>
    </div>
    {open ? <section className="interview-export-options" aria-label="复盘导出选项">
      <div><h3>保存本轮复盘</h3><p>题目、原回答、逐题分析、全部学习建议及引用来源将整理为 Markdown，不会调用模型。</p>
        <p className="interview-export-privacy">原回答与来源路径可能包含个人信息，分享前请自行检查；默认不附带引用原文。</p></div>
      <label><input type="checkbox" checked={includeOriginals} onChange={(event) => setIncludeOriginals(event.target.checked)} />附带引用原文（可能包含敏感信息）</label>
      <div className="interview-export-footer"><span>仅导出本轮已保存内容，不修改原记录。</span><button className="interview-button" type="button" onClick={download}>确认下载 Markdown</button></div>
      {message ? <p role={message.error ? "alert" : "status"}>{message.text}</p> : null}
    </section> : null}
  </div>;
}
