from job_evidence_agent.interview_contracts import GeneratedQuestion, GeneratedReview, ModelResult
from job_evidence_agent.settings import ModelConfig, ModelConfigStore
from job_evidence_agent.models import Claim


class InterviewModel:
    def __init__(self):
        self.questions = []
        self.reviews = []
        self.question_failure = False
        self.review_failure = False

    def generate_interview_question(self, config, context):
        from job_evidence_agent.model_client import ModelConnectionError
        self.questions.append(context.model_copy(deep=True))
        if self.question_failure:
            raise ModelConnectionError("模型超时，重试可能计费")
        text = "你在接口中负责哪部分？" if not context.turns else "你提到的“" + context.turns[-1].answer[:50] + "”如何验证？"
        return ModelResult(value=GeneratedQuestion(question=text, **context.target.model_dump(), evidence_ids=[]), usage={"total_tokens": 20})

    def generate_interview_review(self, config, context):
        from job_evidence_agent.model_client import ModelConnectionError
        self.reviews.append(context.model_copy(deep=True))
        if self.review_failure:
            raise ModelConnectionError("复盘服务暂不可用")
        return ModelResult(value=GeneratedReview(turn_reviews=[{"turn_id": turn.id, "strengths": ["说明了实现"], "missing_details": ["缺少测试细节"], "technical_points": [], "suggestions": ["补充异常测试"], "evidence_ids": []} for turn in context.turns if turn.answer is not None], consistency=[], omissions=[], technical_gaps=[], next_steps=[]))


def configured_store(tmp_path):
    store = ModelConfigStore(tmp_path / "model.env")
    store.save(ModelConfig.create(base_url="https://example.com/v1", model_name="test", api_key="test-key"))
    return store


def confirmed_task(repository):
    task = repository.create_task("面试测试")
    repository.create_claim(Claim(0, task.id, "实现 FastAPI 接口", "项目一", ("fastapi",), "confirmed"))
    repository.mark_report_generated(task.id)
    return task
