export type InterviewTurn = { id: number; ordinal: number; claim_id: number; kind: "main" | "followup"; followup_of_turn_id: number | null; question: string; answer: string | null; evidence_ids: number[] };
export type ReviewPoint = { text: string; turn_ids: number[]; claim_ids: number[]; evidence_ids: number[] };
export type InterviewReview = {
  overall_summary?: string | null;
  answer_consistency?: ReviewPoint[];
  summary: { answered_count: number; unanswered_count: number; question_count: number; partial: boolean; covered_claim_ids: number[]; uncovered_claims: { id: number; text: string }[]; context_truncated: boolean };
  turns: InterviewTurn[];
  turn_reviews: { turn_id: number; strengths: string[]; missing_details: string[]; technical_points: string[]; suggestions: string[]; evidence_ids: number[] }[];
  consistency: ReviewPoint[]; omissions: ReviewPoint[]; technical_gaps: ReviewPoint[]; next_steps: ReviewPoint[];
  evidence: { id: number; text: string; kind: string; locator: string; label: string; relative_path: string }[];
  notice: string;
};
export type InterviewOptions = { mode: "default" | "advanced"; question_count: number; focus_areas: string[]; duration_minutes: number | null };
export type InterviewSession = InterviewOptions & {
  id: number; task_id: number; version: 2; status: "preparing" | "awaiting_answer" | "generating_question" | "ready_to_finish" | "generating_review" | "completed";
  turns: InterviewTurn[]; review: InterviewReview | null; context_truncated: boolean;
  operation: { id: number; kind: "question" | "review"; state: "pending" | "running" | "failed" | "succeeded"; attempt_count: number; safe_error: string | null; retry_allowed: boolean; usage: Record<string, number> | null } | null;
};
export type InterviewSummary = { id: number; task_id: number; version: number; status: string; question_count: number };
export type LegacyInterview = { session: { id: number; task_id: number }; turns: { id: number; question: string; answer: string | null }[]; review: null };

async function request<T>(url: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, payload === undefined ? { signal } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("网络连接失败；回答草稿仍保留，可刷新状态或重试原请求。");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : "请求失败，请刷新状态后重试");
  if (body === null) throw new Error("响应无法读取，请刷新状态确认操作结果");
  return body as T;
}

async function sessionRequest(url: string, payload?: unknown, signal?: AbortSignal) {
  const result = await request<InterviewSession>(url, payload, signal);
  if (result.version !== 2 || !Array.isArray(result.turns) || typeof result.id !== "number") throw new Error("面试响应格式不正确，请刷新后重试");
  return result;
}
export async function listInterviews(taskId: number, signal?: AbortSignal) {
  const result = await request<InterviewSummary[]>(`/api/v2/tasks/${taskId}/interviews`, undefined, signal);
  if (!Array.isArray(result)) throw new Error("面试列表格式不正确，请刷新后重试");
  return result;
}
export const getInterview = (id: number, signal?: AbortSignal) => sessionRequest(`/api/v2/interviews/${id}`, undefined, signal);
export const getLegacyInterview = (id: number, signal?: AbortSignal) => request<LegacyInterview>(`/api/interviews/${id}`, undefined, signal);
export const startInterview = (taskId: number, options: InterviewOptions, requestKey: string, signal?: AbortSignal) => sessionRequest(`/api/v2/tasks/${taskId}/interviews`, { ...options, request_key: requestKey }, signal);
export const submitAnswer = (id: number, turnId: number, answer: string, requestKey: string, signal?: AbortSignal) => sessionRequest(`/api/v2/interviews/${id}/answers`, { turn_id: turnId, answer, request_key: requestKey }, signal);
export const retryOperation = (id: number, operationId: number, signal?: AbortSignal) => sessionRequest(`/api/v2/interviews/${id}/retry`, { operation_id: operationId }, signal);
export const finishInterview = (id: number, requestKey: string, signal?: AbortSignal) => sessionRequest(`/api/v2/interviews/${id}/finish`, { request_key: requestKey }, signal);

const fallback = new Map<string, string>();
export function readLocal(key: string) { try { return sessionStorage.getItem(key) ?? fallback.get(key) ?? null; } catch { return fallback.get(key) ?? null; } }
export function writeLocal(key: string, value: string) { try { sessionStorage.setItem(key, value); } catch { fallback.set(key, value); /* 浏览器禁用存储时仅保留本页面内存。 */ } }
export function removeLocal(key: string) { fallback.delete(key); try { sessionStorage.removeItem(key); } catch { /* 内存副本已清除。 */ } }
export function requestKey(key: string, fingerprint: string) {
  const stored = readLocal(key);
  if (stored) {
    const value = JSON.parse(stored) as { fingerprint: string; key: string };
    if (value.fingerprint !== fingerprint) throw new Error("上次请求结果尚未确认，请先刷新状态；不能用不同内容覆盖已提交请求。");
    return value.key;
  }
  const generated = crypto.randomUUID();
  writeLocal(key, JSON.stringify({ fingerprint, key: generated }));
  return generated;
}
