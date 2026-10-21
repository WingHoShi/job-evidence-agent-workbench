import { useEffect, useState } from "react";
import { Source } from "../workbench/types";

const kindLabels: Record<string, string> = { resume: "简历", job_description: "岗位描述", project: "项目材料", supplement: "补充说明" };
type ChunkPage = { task_id: number; source: Source; total: number; offset: number; limit: number; chunks: { id: number; locator: string; text: string }[] };
type PreviewState = { offset: number; status: "loading" | "error" | "ready"; page?: ChunkPage };

function validPage(value: unknown, taskId: number, sourceId: number, offset: number): value is ChunkPage {
  const page = value as ChunkPage | null;
  return Boolean(page && page.task_id === taskId && page.source?.id === sourceId
    && Number.isSafeInteger(page.total) && page.total >= 0 && page.offset === offset && page.limit === 10
    && Array.isArray(page.chunks) && page.chunks.length === Math.min(10, Math.max(0, page.total - offset))
    && page.chunks.every((chunk) => Number.isSafeInteger(chunk?.id) && chunk.id > 0 && typeof chunk.locator === "string" && typeof chunk.text === "string")
    && new Set(page.chunks.map((chunk) => chunk.id)).size === page.chunks.length);
}

function MaterialPreview({ taskId, source, onClose }: { taskId: number; source: Source; onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<PreviewState>({ offset: 0, status: "loading" });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ offset, status: "loading" });
    const timer = window.setTimeout(() => {
      if (active) { active = false; controller.abort(); setState({ offset, status: "error" }); }
    }, 15000);
    void (async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}/sources/${source.id}/chunks?offset=${offset}&limit=10`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const page: unknown = await response.json();
        if (!validPage(page, taskId, source.id, offset)) throw new Error();
        if (active) setState({ offset, status: "ready", page });
      } catch {
        if (active) setState({ offset, status: "error" });
      } finally { window.clearTimeout(timer); }
    })();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [taskId, source.id, offset, retry]);
  const loading = state.offset !== offset || state.status === "loading";
  const page = !loading && state.status === "ready" ? state.page : undefined;
  return <section className="material-preview" aria-label="解析内容预览">
    <header className="material-preview-heading"><div><p className="eyebrow">解析内容预览</p><h3>{source.label}</h3></div><button type="button" className="material-text-button" onClick={onClose}>关闭预览</button></header>
    <p className="material-preview-note">以下为已入库的解析片段，不是原文件全文；仅在本机读取，不调用模型。</p>
    {loading ? <p role="status">正在读取解析内容…</p> : state.status === "error" ? <div><p role="alert">解析内容读取失败，原材料未改变，请重试。</p><button className="interview-button" type="button" onClick={() => setRetry((value) => value + 1)}>重试读取</button></div> : null}
    {page ? <>
      {page.total ? <><p className="material-preview-count">共 {page.total} 个片段 · 当前 {page.chunks.length ? `${offset + 1}–${offset + page.chunks.length}` : "无片段"}</p>
        <div className="material-preview-chunks">{page.chunks.map((chunk) => <article key={chunk.id}><p className="material-chunk-locator">{chunk.locator}</p><pre>{chunk.text}</pre></article>)}</div></> : <p>这份材料没有已入库的文本片段。</p>}
      {page.total > 10 ? <nav className="material-preview-pagination" aria-label="片段翻页"><button className="material-text-button" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 10))}>上一页</button><span>第 {Math.floor(offset / 10) + 1} / {Math.ceil(page.total / 10)} 页</span><button className="material-text-button" type="button" disabled={offset + 10 >= page.total} onClick={() => setOffset(offset + 10)}>下一页</button></nav> : null}
    </> : null}
  </section>;
}

export function MaterialLibrary({ taskId, sources }: { taskId: number; sources: Source[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const search = query.trim().toLocaleLowerCase();
  const filtered = sources.filter((source) => (!kind || source.kind === kind) && `${source.label}\n${source.relative_path}`.toLocaleLowerCase().includes(search));
  const selected = filtered.find((source) => source.id === selectedId);
  const changeFilter = (value: string, type: "query" | "kind") => {
    setSelectedId(null);
    if (type === "query") setQuery(value); else setKind(value);
  };
  return <article className="panel material-list">
    <div className="panel-title"><h2>已导入材料</h2><span className="material-count">{sources.length} 份材料</span></div>
    <p className="muted-copy">简历用于提取主张，项目材料用于核验，岗位描述用于岗位对照。</p>
    {sources.length ? <>
      <div className="material-library-filters"><label>搜索材料<input type="search" value={query} onChange={(event) => changeFilter(event.target.value, "query")} placeholder="文件名或相对路径" /></label><label>筛选材料类型<select value={kind} onChange={(event) => changeFilter(event.target.value, "kind")}><option value="">全部类型</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className="material-library-summary"><span>显示 {filtered.length} / {sources.length} 份</span>{query || kind ? <button className="material-text-button" type="button" onClick={() => { setQuery(""); setKind(""); setSelectedId(null); }}>清除筛选</button> : null}</div>
      {filtered.length ? <ul className="material-source-list">{filtered.map((source) => <li key={source.id} className={selected?.id === source.id ? "is-selected" : ""}>
        <button className="material-source-button" type="button" aria-label={`查看解析内容：${source.label}`} aria-pressed={selected?.id === source.id} onClick={() => setSelectedId(selected?.id === source.id ? null : source.id)}><span className="material-file"><strong>{source.label}</strong><span>{source.relative_path}</span></span><span className="material-source-action">查看内容</span></button>
        <span className="material-kind">{kindLabels[source.kind] || source.kind}</span>
      </li>)}</ul> : <div className="material-empty"><strong>没有符合条件的材料</strong><p>试试其他关键词或清除筛选。</p></div>}
      {selected ? <MaterialPreview key={`${taskId}:${selected.id}`} taskId={taskId} source={selected} onClose={() => setSelectedId(null)} /> : null}
    </> : <div className="material-empty"><strong>还没有材料</strong><p>从左侧导入简历、岗位描述或项目文件。</p></div>}
  </article>;
}
