import json
from unittest.mock import patch

import httpx
import pytest

from job_evidence_agent.interview_context import build_question_input, build_review_input, select_question_target
from job_evidence_agent.interview_contracts import TurnView
from job_evidence_agent.model_client import ModelConnectionError, OpenAICompatibleClient
from job_evidence_agent.settings import ModelConfig
from test_interview_context import snapshot

CONFIG = ModelConfig.create(base_url="https://example.com/v1", model_name="test", api_key="sk-test-secret")
QUESTION = {"question": "接口怎样处理异常？", "kind": "main", "claim_id": 1, "followup_of_turn_id": None, "evidence_ids": [4]}


def completion(value, finish="stop"):
    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(value, ensure_ascii=False)}, "finish_reason": finish}], "usage": {"total_tokens": 30}})


def question_input():
    context = snapshot()
    return build_question_input(context, [], select_question_target(context, [], 5))


def test_question_request_contains_risk_and_contract_and_records_usage():
    def respond(*args, **kwargs):
        payload = kwargs["json"]
        assert payload["max_tokens"] == 1000
        assert "不可信" in payload["messages"][0]["content"]
        assert "followup_of_turn_id" in payload["messages"][0]["content"]
        assert "需关注" in payload["messages"][1]["content"]
        return completion(QUESTION)
    with patch("job_evidence_agent.model_client.httpx.post", side_effect=respond):
        result = OpenAICompatibleClient().generate_interview_question(CONFIG, question_input())
    assert result.value.question == "接口怎样处理异常？"
    assert result.usage == {"total_tokens": 30}


@pytest.mark.parametrize("change", [{"claim_id": 2}, {"evidence_ids": [999]}, {"followup_of_turn_id": 99}, {"question": "长" * 301}, {"claim_id": True}])
def test_invalid_question_rejected_with_shared_two_call_budget(change):
    with patch("job_evidence_agent.model_client.httpx.post", return_value=completion(QUESTION | change)) as post:
        with pytest.raises(ModelConnectionError, match="协议"):
            OpenAICompatibleClient().generate_interview_question(CONFIG, question_input())
    assert post.call_count == 2


def test_json_fallback_and_invalid_reply_share_budget():
    with patch("job_evidence_agent.model_client.httpx.post", side_effect=[httpx.Response(400, text="response_format unsupported"), completion(QUESTION | {"claim_id": 999})]) as post:
        with pytest.raises(ModelConnectionError):
            OpenAICompatibleClient().generate_interview_question(CONFIG, question_input())
    assert post.call_count == 2
    assert "response_format" not in post.call_args_list[1].kwargs["json"]


@pytest.mark.parametrize("failure", [httpx.Response(401, text="sk-test-secret"), httpx.Response(429, text="private"), httpx.ReadTimeout("sk-test-secret")])
def test_remote_errors_do_not_blindly_retry_or_leak_secrets(failure):
    with patch("job_evidence_agent.model_client.httpx.post", side_effect=failure if isinstance(failure, Exception) else None, return_value=failure) as post:
        with pytest.raises(ModelConnectionError) as error:
            OpenAICompatibleClient().generate_interview_question(CONFIG, question_input())
    assert post.call_count == 1
    assert "sk-test-secret" not in str(error.value)


def test_truncated_output_is_not_saved_as_complete():
    with patch("job_evidence_agent.model_client.httpx.post", return_value=completion(QUESTION, "length")):
        with pytest.raises(ModelConnectionError, match="截断|协议"):
            OpenAICompatibleClient().generate_interview_question(CONFIG, question_input())


def test_review_must_cover_exact_answered_turns_and_valid_references():
    turn = TurnView(id=7, ordinal=1, question="接口怎么做？", kind="main", claim_id=1, followup_of_turn_id=None, answer="使用路由函数", evidence_ids=[4])
    context = build_review_input(snapshot(), [turn])
    review = {"turn_reviews": [{"turn_id": 7, "strengths": ["说明路由"], "missing_details": ["测试方式"], "technical_points": [], "suggestions": ["补充异常测试"], "evidence_ids": [4]}], "consistency": [], "omissions": [], "technical_gaps": [], "next_steps": []}
    with patch("job_evidence_agent.model_client.httpx.post", return_value=completion(review)) as post:
        result = OpenAICompatibleClient().generate_interview_review(CONFIG, context)
    assert result.value.turn_reviews[0].turn_id == 7
    assert post.call_args.kwargs["json"]["max_tokens"] == 6000
    review["turn_reviews"][0]["turn_id"] = 999
    with patch("job_evidence_agent.model_client.httpx.post", return_value=completion(review)):
        with pytest.raises(ModelConnectionError, match="协议"):
            OpenAICompatibleClient().generate_interview_review(CONFIG, context)


def test_format_repair_records_usage_from_both_requests():
    with patch("job_evidence_agent.model_client.httpx.post", side_effect=[completion({"invalid": True}), completion(QUESTION)]):
        result = OpenAICompatibleClient().generate_interview_question(CONFIG, question_input())
    assert result.usage == {"total_tokens": 60}


def concise_review():
    return {"overall_summary": "本轮尚未说明实现。", "answer_consistency": [], "turn_reviews": [{"turn_id": 7, "strengths": [], "missing_details": ["缺少路由说明"], "technical_points": ["路由关联处理函数"], "suggestions": ["练习最小路由"], "evidence_ids": [4]}], "consistency": [], "omissions": [], "technical_gaps": [], "next_steps": []}


def review_input():
    return build_review_input(snapshot(), [TurnView(id=7, ordinal=1, question="接口怎么做？", kind="main", claim_id=1, followup_of_turn_id=None, answer="不清楚", evidence_ids=[4])])


@pytest.mark.parametrize("field,value", [("missing_details", ["长" * 61]), ("suggestions", ["建议一", "建议二"])])
def test_verbose_turn_review_is_repaired_without_dropping_answered_turn(field, value):
    verbose = concise_review()
    verbose["turn_reviews"][0][field] = value
    with patch("job_evidence_agent.model_client.httpx.post", side_effect=[completion(verbose), completion(concise_review())]) as post:
        result = OpenAICompatibleClient().generate_interview_review(CONFIG, review_input())
    assert post.call_count == 2
    assert result.value.turn_reviews[0].missing_details == ["缺少路由说明"]
    assert result.value.turn_reviews[0].turn_id == 7
    assert result.usage == {"total_tokens": 60}
    assert all(call.kwargs["json"]["max_tokens"] == 6000 for call in post.call_args_list)


@pytest.mark.parametrize("field,value", [
    ("overall_summary", "长" * 161),
    ("next_steps", [{"text": "学习", "turn_ids": [7], "claim_ids": [1], "evidence_ids": [4]}] * 4),
    ("technical_gaps", [{"text": "长" * 81, "turn_ids": [7], "claim_ids": [1], "evidence_ids": [4]}]),
])
def test_verbose_review_summary_is_rejected_with_bounded_repair(field, value):
    verbose = concise_review() | {field: value}
    with patch("job_evidence_agent.model_client.httpx.post", return_value=completion(verbose)) as post:
        with pytest.raises(ModelConnectionError, match="协议"):
            OpenAICompatibleClient().generate_interview_review(CONFIG, review_input())
    assert post.call_count == 2


def test_review_truncation_preserves_manual_retry_boundary_and_actionable_error():
    with patch("job_evidence_agent.model_client.httpx.post", return_value=completion(concise_review(), "length")) as post:
        with pytest.raises(ModelConnectionError) as error:
            OpenAICompatibleClient().generate_interview_review(CONFIG, review_input())
    assert post.call_count == 1
    assert "回答已保存" in str(error.value)
    assert "调整模型配置" not in str(error.value)


def test_compact_review_covers_ten_answers_in_one_normal_call():
    turns = [TurnView(id=i, ordinal=i, question="接口怎么做？", kind="main", claim_id=1, followup_of_turn_id=None, answer="不清楚", evidence_ids=[4]) for i in range(1, 11)]
    review = concise_review()
    review["turn_reviews"] = [review["turn_reviews"][0] | {"turn_id": i} for i in range(1, 11)]
    with patch("job_evidence_agent.model_client.httpx.post", return_value=completion(review)) as post:
        result = OpenAICompatibleClient().generate_interview_review(CONFIG, build_review_input(snapshot(), turns))
    assert [item.turn_id for item in result.value.turn_reviews] == list(range(1, 11))
    assert post.call_count == 1


@pytest.mark.parametrize("invalid", [None, "text", [], 1])
def test_malformed_choice_envelope_becomes_safe_protocol_failure(monkeypatch, invalid):
    calls = []
    def post(*args, **kwargs):
        calls.append(kwargs)
        return httpx.Response(200, json={"choices": [invalid]})
    monkeypatch.setattr(httpx, "post", post)
    with pytest.raises(ModelConnectionError, match="面试协议"):
        OpenAICompatibleClient().generate_interview_question(CONFIG, question_input())
    assert len(calls) == 2
