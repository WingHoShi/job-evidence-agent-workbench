import { ChangeEvent, FormEvent, useRef, useState } from "react";

import { Source } from "../workbench/types";

const sourceKindLabels: Record<string, string> = { resume: "简历", job_description: "岗位描述", project: "项目材料", supplement: "补充说明" };

export function MaterialsPage({ taskId, sources, onChanged }: { taskId: number; sources: Source[]; onChanged: () => void }) {
  const [kind, setKind] = useState("project");
  const [importMode, setImportMode] = useState<"files" | "directory" | "text">("files");
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
    <section className="materials-workspace">
      <header className="page-header"><p className="eyebrow">准备材料</p><h1>材料中心</h1><p>材料保存在本机；审计与面试时，选中内容会发送给你配置的模型服务。</p></header>
      <section className="materials-grid">
        <article className="panel material-import">
          <h2>导入材料</h2>
          <p className="muted-copy">先选材料类型，再选择一种导入方式。</p>
          <label>材料类型<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="resume">简历</option><option value="job_description">岗位描述</option><option value="project">项目材料</option></select></label>
          <div className="import-modes" role="group" aria-label="导入方式">
            <button type="button" aria-pressed={importMode === "files"} onClick={() => setImportMode("files")}>上传文件</button>
            <button type="button" aria-pressed={importMode === "directory"} onClick={() => setImportMode("directory")}>项目目录</button>
            <button type="button" aria-pressed={importMode === "text"} onClick={() => setImportMode("text")}>粘贴文本</button>
          </div>
          {importMode === "files" ? <div className="import-file-area">
            <label>批量选择文件<input aria-label="批量选择文件" type="file" multiple onChange={importFiles} /></label>
            <p className="muted-copy">支持 Markdown、TXT、DOCX、可复制文本 PDF 和常见源码文本。</p>
          </div> : null}
          {importMode === "directory" ? <div className="import-file-area">
            <button className="interview-button" type="button" onClick={() => directoryInput.current?.click()}>选择项目目录</button>
            <input ref={directoryInput} aria-label="选择项目目录" type="file" multiple hidden onChange={importFiles} {...({ webkitdirectory: "" } as Record<string, string>)} />
            <p className="muted-copy">保留相对路径，跳过 .env、.git、依赖目录与二进制文件。导入前仍需检查敏感内容。</p>
          </div> : null}
          {importMode === "text" ? <form className="paste-import" onSubmit={importText}>
            <label htmlFor="source-label">材料名称</label>
            <input id="source-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：个人简历" required />
            <label htmlFor="source-text">粘贴材料</label>
            <textarea id="source-text" value={text} onChange={(event) => setText(event.target.value)} placeholder="在此粘贴简历、岗位描述或项目说明" required />
            <button className="interview-button" type="submit">导入粘贴材料</button>
          </form> : null}
          {message ? <p className={`material-feedback${isError ? " is-error" : ""}`} role={isError ? "alert" : "status"}>{message}</p> : null}
        </article>
        <article className="panel material-list">
          <div className="panel-title"><h2>已导入材料</h2><span className="material-count">{sources.length} 份材料</span></div>
          <p className="muted-copy">简历用于提取主张，项目材料用于核验，岗位描述用于岗位对照。</p>
          {sources.length ? <ul>{sources.map((source) => <li key={source.id}>
            <div className="material-file"><strong>{source.label}</strong><span>{source.relative_path}</span></div>
            <span className="material-kind">{sourceKindLabels[source.kind] || source.kind}</span>
          </li>)}</ul> : <div className="material-empty"><strong>还没有材料</strong><p>从左侧导入简历、岗位描述或项目文件。</p></div>}
        </article>
      </section>
      <section className="panel material-next-action">
        <div><p className="eyebrow">下一步</p><h2>提取能力主张</h2><p className="muted-copy">仅从简历提取既有主张，项目材料用于核验，不会新增经历。</p></div>
        <button className="primary-button" type="button" onClick={generateClaims} disabled={!sources.length}>提取能力主张</button>
      </section>
    </section>
  );
}
