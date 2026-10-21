import { ChangeEvent, FormEvent, useRef, useState } from "react";

import { Source } from "../workbench/types";
import { MaterialLibrary } from "./MaterialLibrary";

type ImportResult = { imported_count: number; skipped_paths: string[]; errors: string[] };
function isImportResult(value: unknown): value is ImportResult {
  const result = value as ImportResult | null;
  return Boolean(result && Number.isSafeInteger(result.imported_count) && result.imported_count >= 0
    && Array.isArray(result.skipped_paths) && result.skipped_paths.every((item) => typeof item === "string")
    && Array.isArray(result.errors) && result.errors.every((item) => typeof item === "string"));
}

export function MaterialsPage({ taskId, sources, onChanged }: { taskId: number; sources: Source[]; onChanged: () => void | Promise<void> }) {
  const [kind, setKind] = useState("project");
  const [importMode, setImportMode] = useState<"files" | "directory" | "text">("files");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const directoryInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const locked = useRef(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshSubject, setRefreshSubject] = useState("材料已保存");
  const refreshLock = useRef(false);
  const begin = (description: string, subject = "材料已保存") => {
    if (locked.current || refreshLock.current) return false;
    locked.current = true; setBusy(description); setMessage(null); setIsError(false);
    setResult(null); setUncertain(false); setRefreshFailed(false);
    setRefreshSubject(subject);
    return true;
  };
  const finish = () => { locked.current = false; setBusy(null); };
  const unknownImport = () => {
    setIsError(true); setUncertain(true);
    setMessage("未能确认本次导入结果，请先刷新材料列表核对；不要直接重复上传。");
  };
  const refreshMaterials = async () => {
    if (refreshLock.current) return;
    refreshLock.current = true; setRefreshing(true); setRefreshFailed(false);
    try { await onChanged(); }
    catch { setRefreshFailed(true); }
    finally { refreshLock.current = false; setRefreshing(false); }
  };

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length || !begin(`正在导入 ${files.length} 个文件，请等待处理完成…`)) return;
    try {
      const formData = new FormData();
      formData.append("kind", kind);
      for (const file of files) formData.append("files", file, file.webkitRelativePath || file.name);
      const response = await fetch(`/api/tasks/${taskId}/sources/import`, { method: "POST", body: formData });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status >= 500) { unknownImport(); return; }
        setIsError(true); setMessage(typeof body?.detail === "string" ? body.detail : "文件导入请求未通过，请检查材料和服务状态。");
        return;
      }
      if (!isImportResult(body)) { unknownImport(); return; }
      setResult(body); setIsError(body.errors.length > 0);
      setMessage(`已导入 ${body.imported_count} 个文件${body.skipped_paths.length ? `，已跳过 ${body.skipped_paths.length} 个文件` : ""}${body.errors.length ? `；有 ${body.errors.length} 条错误信息` : ""}`);
      await refreshMaterials();
    } catch { unknownImport(); }
    finally { input.value = ""; finish(); }
  };

  const importText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!begin("正在导入粘贴材料，请等待处理完成…")) return;
    try {
      const response = await fetch(`/api/tasks/${taskId}/sources/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label, text }),
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        if (response.status >= 500) { unknownImport(); return; }
        setIsError(true);
        setMessage(result?.detail || "粘贴材料导入失败，请检查后重试");
        return;
      }
      if (!result) { unknownImport(); return; }
      setLabel("");
      setText("");
      setMessage("粘贴材料已导入");
      await refreshMaterials();
    } catch { unknownImport(); }
    finally { finish(); }
  };

  const generateClaims = async () => {
    if (!begin("正在提取能力主张…", "主张已提取")) return;
    try {
      const response = await fetch(`/api/tasks/${taskId}/claims/generate`, { method: "POST" });
      const claims = (await response.json().catch(() => null)) as { id: number }[] | { detail?: string } | null;
      if (!response.ok) {
        setIsError(true);
        setMessage((claims as { detail?: string } | null)?.detail || "能力主张提取失败，请检查模型配置后重试");
        return;
      }
      setMessage(`已提取 ${Array.isArray(claims) ? claims.length : 0} 条能力主张`);
      await refreshMaterials();
    } catch {
      setIsError(true);
      setMessage("能力主张提取失败，请检查网络或服务状态后重试");
    } finally { finish(); }
  };

  return (
    <section className="materials-workspace">
      <header className="page-header"><p className="eyebrow">准备材料</p><h1>材料中心</h1><p>材料保存在本机；审计与面试时，选中内容会发送给你配置的模型服务。</p></header>
      <section className="materials-grid">
        <article className="panel material-import">
          <h2>导入材料</h2>
          <p className="muted-copy">先选材料类型，再选择一种导入方式。</p>
          <fieldset className="material-import-controls" disabled={Boolean(busy) || refreshing}>
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
          </fieldset>
          {busy ? <p className="material-progress" role="status">{refreshing ? "正在刷新材料列表…" : busy}</p> : null}
          {message ? <p className={`material-feedback${result?.errors.length ? " is-warning" : isError ? " is-error" : ""}`} role={isError ? "alert" : "status"}>{message}</p> : null}
          {result && (result.skipped_paths.length > 0 || result.errors.length > 0) ? <details className="material-import-details"><summary>查看跳过与错误明细</summary>
            {result.errors.length ? <p>解析失败的文件也计入跳过数量，错误条数不能与跳过数量相加。</p> : null}
            {result.skipped_paths.length ? <><h3>已跳过 · {result.skipped_paths.length}</h3><ul>{result.skipped_paths.map((path, index) => <li key={index}>{path}</li>)}</ul></> : null}
            {result.errors.length ? <><h3>错误信息 · {result.errors.length}</h3><ul>{result.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></> : null}
          </details> : null}
          {refreshFailed ? <p className="material-feedback is-error" role="alert">{uncertain ? "材料列表刷新失败，导入结果仍未确认。" : `${refreshSubject}，但列表刷新失败，请先刷新列表，不要重复提交。`}</p> : null}
          {uncertain || refreshFailed ? <button className="interview-button material-refresh" type="button" disabled={Boolean(busy) || refreshing} onClick={() => void refreshMaterials()}>{refreshing ? "正在刷新…" : "刷新材料列表"}</button> : null}
        </article>
        <MaterialLibrary key={taskId} taskId={taskId} sources={sources} />
      </section>
      <section className="panel material-next-action">
        <div><p className="eyebrow">下一步</p><h2>提取能力主张</h2><p className="muted-copy">仅从简历提取既有主张，项目材料用于核验，不会新增经历。</p></div>
        <button className="primary-button" type="button" onClick={generateClaims} disabled={!sources.length || Boolean(busy) || refreshing}>提取能力主张</button>
      </section>
    </section>
  );
}
