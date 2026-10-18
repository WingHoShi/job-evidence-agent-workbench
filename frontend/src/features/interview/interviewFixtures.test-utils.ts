import type { InterviewSession } from "./interviewApi";

export function sessionFixture(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return { id: 9, task_id: 7, version: 2, mode: "default", question_count: 2, focus_areas: [], duration_minutes: null,
    status: "awaiting_answer", context_truncated: false, review: null,
    operation: { id: 1, kind: "question", state: "succeeded", attempt_count: 1, safe_error: null, retry_allowed: false, usage: null },
    turns: [{ id: 1, ordinal: 1, claim_id: 2, kind: "main", followup_of_turn_id: null, question: "接口如何实现？", answer: null, evidence_ids: [] }], ...overrides };
}

export function jsonResponse(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
