export function reportFixture(taskId = 7, title = "虚构接口实现") {
  return {
    task_id: taskId, generated_at: "2026-10-22T10:00:00", confirmed_claims: [[title, "简历第1条"]],
    insufficient_claims: [title], conflicts: [], next_steps: ["补充虚构运行记录"], jd_coverage: "未导入岗位描述，无法分析岗位覆盖情况。",
    jd_requirements: [{ text: "熟悉 Python", locator: "岗位第1条", keywords: ["python"], claim_ids: [1], status: "有关联主张，证据待补" }],
    claim_reviews: [{ claim_id: 1, text: title, resume_locator: "简历第1条", review_status: "人工已接受", verdict: "部分支持", risk: "需关注",
      rationale: "仅有虚构接口代码", gate_reason: "需人工核对", warning: "人工接受不等于证据充分", suggestions: ["补充运行记录"],
      evidence: [{ chunk_id: 8, source_kind: "project", source_label: "虚构源码", relative_path: "src/app.py", locator: "line:1", excerpt: 'app = FastAPI()' }] }],
  };
}
