import { ChangeEvent, FormEvent, useRef, useState } from "react";

import { Source } from "../workbench/types";

export function MaterialsPage({ taskId, sources, onChanged }: { taskId: number; sources: Source[]; onChanged: () => void }) {
  const [kind, setKind] = useState("project");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const directoryInput = useRef<HTMLInputElement>(null);

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    setIsError(false);
    setMessage(null);
    const formData = new FormData();
    formData.append("kind", kind);
    for (const file of Array.from(event.target.files)) formData.append("files", file, file.webkitRelativePath || file.name);
    const response = await fetch(`/api/tasks/${taskId}/sources/import`, { method: "POST", body: formData });
    const result = (await response.json().catch(() => null)) as { imported_count?: number; skipped_paths?: string[]; detail?: string } | null;
    if (!response.ok) {
      setIsError(true);
      setMessage(result?.detail || "文件导入失败，请检查后重试");
      return;
    }
    const skipped = result?.skipped_paths?.length || 0;
    setMessage(`已导入 ${result?.imported_count || 0} 个文件${skipped ? `，已跳过 ${skipped} 个不允许的文件` : ""}`);
    onChanged();
    event.target.value = "";
  };

  const importText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsError(false);
    setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/sources/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label, text }),
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        setIsError(true);
        setMessage(result?.detail || "粘贴材料导入失败，请检查后重试");
        return;
      }
      setLabel("");
      setText("");
      setMessage("粘贴材料已导入");
      onChanged();
    } catch {
      setIsError(true);
      setMessage("粘贴材料导入失败，请检查网络或服务状态后重试");
    }
  };

  const generateClaims = async () => {
    setIsError(false);
    setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/claims/generate`, { method: "POST" });
      const claims = (await response.json().catch(() => null)) as { id: number }[] | { detail?: string } | null;
      if (!response.ok) {
        setIsError(true);
        setMessage((claims as { detail?: string } | null)?.detail || "能力主张提取失败，请检查模型配置后重试");
        return;
      }
      setMessage(`已提取 ${Array.isArray(claims) ? claims.length : 0} 条能力主张`);
      onChanged();
    } catch {
      setIsError(true);
      setMessage("能力主张提取失败，请检查网络或服务状态后重试");
    }
  };

  return (
    <section>
      <header className="page-header"><p className="eyebrow">当前阶段</p><h1>材料中心</h1><p>导入简历、岗位描述与项目材料，所有材料仅保留在本机。</p></header>
      <section className="materials-grid">
        <article className="panel">
          <h2>导入材料</h2>
          <label>材料类型<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="resume">简历</option><option value="job_description">岗位描述</option><option value="project">项目材料</option></select></label>
          <label>批量选择文件<input aria-label="批量选择文件" type="file" multiple onChange={importFiles} /></label>
          <div className="secondary-actions">
            <button type="button" onClick={() => directoryInput.current?.click()}>选择项目目录</button>
            <input ref={directoryInput} aria-label="选择项目目录" type="file" multiple hidden onChange={importFiles} {...({ webkitdirectory: "" } as Record<string, string>)} />
          </div>
          <p className="muted-copy">支持 Markdown、TXT、DOCX、可复制文本 PDF 和安全项目目录中的文本文件。</p>
          <form className="paste-import" onSubmit={importText}>
            <label htmlFor="source-label">材料名称</label>
            <input id="source-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：个人简历" required />
            <label htmlFor="source-text">粘贴材料</label>
            <textarea id="source-text" value={text} onChange={(event) => setText(event.target.value)} placeholder="在此粘贴简历、岗位描述或项目说明" required />
            <button type="submit">导入粘贴材料</button>
          </form>
          {message ? <p role={isError ? "alert" : "status"}>{message}</p> : null}
        </article>
        <article className="panel"><h2>导入摘要</h2><strong>{sources.length}</strong><span>份已导入材料</span><p className="muted-copy">敏感文件、依赖目录和二进制文件会自动跳过。</p></article>
      </section>
      <section className="panel action-panel">
        <h2>提取能力主张</h2>
        <p className="muted-copy">材料导入完成后，系统会基于简历和项目材料提取可逐条审核的能力主张。</p>
        <button className="primary-button" type="button" onClick={generateClaims} disabled={!sources.length}>提取能力主张</button>
      </section>
      <section className="panel material-list"><h2>已导入材料</h2>{sources.length ? <ul>{sources.map((source) => <li key={source.id}><strong>{source.label}</strong><span>{source.kind} · {source.relative_path}</span></li>)}</ul> : <p>还没有材料。请先选择要导入的文件。</p>}</section>
    </section>
  );
}
