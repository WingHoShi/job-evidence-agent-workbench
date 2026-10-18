import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { ReportPage } from "../reports/ReportPage";
import { InterviewWorkspace } from "../interview/InterviewWorkspace";
import { AuditPage } from "../audit/AuditPage";

type Task = {
  id: number;
  name: string;
  status: string;
};

type ImportResult = {
  imported_count: number;
  skipped_paths: string[];
  errors: string[];
};
type Claim = { id: number; text: string; resume_locator: string; capability_tags: string[]; status: string };
type Evidence = { id: number; text: string; locator: string };
type Assessment = { verdict: "strong" | "partial" | "none" | "conflict"; rationale: string };
type Gate = { eligible: boolean; requires_review: boolean; reason: string };

export function NewTaskPage() {
  const [taskName, setTaskName] = useState("");
  const [task, setTask] = useState<Task | null>(null);
  const [kind, setKind] = useState("project");
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [evidence, setEvidence] = useState<Record<number, Evidence[]>>({});
  const [assessments, setAssessments] = useState<Record<number, { assessment: Assessment; gate: Gate }>>({});
  const [audit, setAudit] = useState<{ status: string; claim_id: number | null; events: string[] } | null>(null);
  const [editText, setEditText] = useState("");
  const [supplement, setSupplement] = useState("");
  const [reportReady, setReportReady] = useState(false);
  const directoryInput = useRef<HTMLInputElement>(null);

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: taskName }),
      });
      if (!response.ok) {
        throw new Error("创建任务失败，请检查任务名称")
      }
      setTask((await response.json()) as Task);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建任务失败")
    }
  };

  const importText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!task) return;
    setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${task.id}/sources/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label, text }),
      });
      if (!response.ok) {
        throw new Error("粘贴材料导入失败")
      }
      setLabel("");
      setText("");
      setMessage("粘贴材料已导入")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "粘贴材料导入失败")
    }
  };

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!task || !event.target.files?.length) return;
    setMessage(null);
    const formData = new FormData();
    formData.append("kind", kind);
    for (const file of Array.from(event.target.files)) {
      formData.append("files", file, file.webkitRelativePath || file.name);
    }
    try {
      const response = await fetch(`/api/tasks/${task.id}/sources/import`, {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as ImportResult;
      if (!response.ok) {
        throw new Error("文件导入失败")
      }
      const skipped = result.skipped_paths.length;
      setMessage(`已导入 ${result.imported_count} 个文件${skipped ? `，已跳过 ${skipped} 个不允许的文件` : ""}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文件导入失败")
    } finally {
      event.target.value = "";
    }
  };

  const generateClaims = async () => {
    if (!task) return;
    const response = await fetch(`/api/tasks/${task.id}/claims/generate`, { method: "POST" });
    if (response.ok) setClaims((await response.json()) as Claim[]);
  };
  const reviewClaim = async (claimId: number, status: string) => {
    if (!task) return;
    const response = await fetch(`/api/tasks/${task.id}/claims/${claimId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (response.ok) {
      const updated = (await response.json()) as Claim;
      setClaims((items) => items.map((item) => item.id === updated.id ? updated : item));
    }
  };
  const loadEvidence = async (claimId: number) => {
    if (!task) return;
    const response = await fetch(`/api/tasks/${task.id}/claims/${claimId}/assessment`, { method: "POST" });
    if (response.ok) {
      const result = (await response.json()) as { evidence: Evidence[]; assessment: Assessment; gate: Gate };
      setEvidence((current) => ({ ...current, [claimId]: result.evidence }));
      setAssessments((current) => ({ ...current, [claimId]: { assessment: result.assessment, gate: result.gate } }));
    } else {
      setMessage("证据判定失败，请检查模型配置后重试")
    }
  };
  const startAudit = async () => {
    if (!task) return;
    const response = await fetch(`/api/tasks/${task.id}/audit/start`, { method: "POST" });
    if (response.ok) setAudit(await response.json());
  };
  const decideAudit = async (decision: "accepted" | "rejected" | "supplement") => {
    if (!task) return;
    const response = await fetch(`/api/tasks/${task.id}/audit/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, edited_text: editText || undefined, supplemental_text: supplement || undefined }) });
    if (response.ok) setAudit(await response.json());
  };

  return (
    <main>
      <h1>求职证据审计与模拟面试工作台</h1>
      {!task ? (
        <form onSubmit={createTask}>
          <p>
            <label htmlFor="task-name">任务名称</label>
            <input
              id="task-name"
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
              placeholder="例如：AI 应用开发岗位"
              required
            />
          </p>
          <button type="submit">创建任务</button>
        </form>
      ) : (
        <section>
          <h2>导入材料</h2>
          <p>当前任务：{task.name}</p>
          <p>
            <label htmlFor="source-kind">材料类型</label>
            <select
              id="source-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="resume">简历</option>
              <option value="job_description">岗位描述</option>
              <option value="project">项目材料</option>
            </select>
          </p>
          <p>
            <label htmlFor="file-import">批量选择文件</label>
            <input id="file-import" type="file" multiple onChange={importFiles} />
          </p>
          <p>
            <button type="button" onClick={() => directoryInput.current?.click()}>
              选择项目目录
            </button>
            <input
              ref={directoryInput}
              type="file"
              multiple
              hidden
              onChange={importFiles}
              {...({ webkitdirectory: "" } as Record<string, string>)}
            />
          </p>
          <form onSubmit={importText}>
            <p>
              <label htmlFor="source-label">材料名称</label>
              <input
                id="source-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="例如：个人简历"
                required
              />
            </p>
            <p>
              <label htmlFor="source-text">粘贴材料</label>
              <textarea
                id="source-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                required
              />
            </p>
            <button type="submit">导入粘贴材料</button>
          </form>
          <p><button type="button" onClick={generateClaims}>生成待审核主张</button></p>
          <p><button type="button" onClick={startAudit}>开始逐条审核</button></p>
          {audit?.claim_id ? <section><AuditPage claim={claims.find((item) => item.id === audit.claim_id) || null} evidence={evidence[audit.claim_id] || []} assessment={assessments[audit.claim_id]?.assessment} gate={assessments[audit.claim_id]?.gate} events={audit.events} onDecision={decideAudit} /><button type="button" onClick={() => loadEvidence(audit.claim_id as number)}>运行候选证据判定</button><textarea aria-label="编辑主张" value={editText} onChange={(event) => setEditText(event.target.value)} placeholder="可选：编辑主张后再接受或拒绝"/><textarea aria-label="补充证据" value={supplement} onChange={(event) => setSupplement(event.target.value)} placeholder="补证后点击“补充证据”"/><button type="button" onClick={() => decideAudit("supplement")}>保存补证</button></section> : null}
          {audit && !audit.claim_id ? <AuditPage claim={null} evidence={[]} events={audit.events} onDecision={decideAudit} /> : null}
          {audit?.status === "completed" ? <ReportPage taskId={task.id} onGenerated={() => setReportReady(true)} /> : null}
          {audit?.status === "completed" && reportReady ? <InterviewWorkspace taskId={task.id} reportReady onChanged={() => {}} /> : null}
          {claims.map((claim) => (
            <article key={claim.id}>
              <strong>{claim.text}</strong>
              <p>来源：{claim.resume_locator}；标签：{claim.capability_tags.join("、") || "未识别"}</p>
              <p>状态：{claim.status}</p>
              <button type="button" onClick={() => loadEvidence(claim.id)}>查看候选证据</button>
              {(evidence[claim.id] || []).map((item) => <p key={item.id}>证据：{item.text}（{item.locator}）</p>)}
              <button type="button" onClick={() => reviewClaim(claim.id, "confirmed")}>确认</button>{" "}
              <button type="button" onClick={() => reviewClaim(claim.id, "rejected")}>拒绝</button>
            </article>
          ))}
        </section>
      )}
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
