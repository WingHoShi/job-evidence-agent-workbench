from unittest.mock import patch

import httpx
import pytest

from job_evidence_agent.model_client import ModelConnectionError, OpenAICompatibleClient
from job_evidence_agent.models import Claim, EvidenceChunk
from job_evidence_agent.settings import ModelConfig


CONFIG = ModelConfig.create(base_url="https://api.example.com/v1", model_name="test", api_key="sk-test-secret")
CLAIM = Claim(1, 1, "熟悉 FastAPI", "第 1 段", ("fastapi",), "pending_review")
CANDIDATES = [EvidenceChunk(2, 3, "FastAPI 服务入口", "README", "zh")]
VALID_CONTENT = '{"verdict":"partial","links":[2],"rationale":"候选材料包含接口实现"}'


def completion(content: object) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def test_assessment_request_teaches_the_model_the_required_output_contract() -> None:
    def model_response(*args, **kwargs):
        messages = kwargs["json"]["messages"]
        instructions = "\n".join(item["content"] for item in messages if item["role"] == "system")
        required = ("verdict", "links", "rationale", "strong", "partial", "none", "conflict")
        valid_contract = all(term in instructions for term in required)
        return completion(VALID_CONTENT if valid_contract else '{"结果":"部分支持"}')

    with patch("job_evidence_agent.model_client.httpx.post", side_effect=model_response):
        result = OpenAICompatibleClient().assess_evidence(CONFIG, CLAIM, CANDIDATES)

    assert result.verdict == "partial"
    assert result.links == (2,)


@pytest.mark.parametrize(("status", "expected"), [
    (401, "API Key"), (403, "API Key"), (404, "Base URL"),
    (429, "限流"), (500, "模型服务暂时不可用"), (400, "请求参数"),
])
def test_http_errors_have_safe_specific_messages_without_blind_retries(status: int, expected: str) -> None:
    response = httpx.Response(status, json={"error": {"message": "private sk-test-secret provider details"}})
    with patch("job_evidence_agent.model_client.httpx.post", return_value=response) as post:
        with pytest.raises(ModelConnectionError, match=expected) as failure:
            OpenAICompatibleClient().assess_evidence(CONFIG, CLAIM, CANDIDATES)

    assert post.call_count == 1
    assert "sk-test-secret" not in str(failure.value)
    assert "private" not in str(failure.value)


@pytest.mark.parametrize(("error", "expected"), [
    (httpx.ReadTimeout("private sk-test-secret"), "超时"),
    (httpx.ConnectError("private sk-test-secret"), "连接"),
])
def test_transport_errors_are_not_reported_as_invalid_model_json(error: Exception, expected: str) -> None:
    with patch("job_evidence_agent.model_client.httpx.post", side_effect=error) as post:
        with pytest.raises(ModelConnectionError, match=expected) as failure:
            OpenAICompatibleClient().assess_evidence(CONFIG, CLAIM, CANDIDATES)

    assert post.call_count == 1
    assert "sk-test-secret" not in str(failure.value)


def test_explicitly_unsupported_json_mode_falls_back_once_without_relaxing_validation() -> None:
    responses = [
        httpx.Response(400, json={"error": {"message": "response_format json_object is not supported"}}),
        completion(VALID_CONTENT),
    ]
    with patch("job_evidence_agent.model_client.httpx.post", side_effect=responses) as post:
        result = OpenAICompatibleClient().assess_evidence(CONFIG, CLAIM, CANDIDATES)

    assert result.links == (2,)
    assert post.call_args_list[0].kwargs["json"]["response_format"] == {"type": "json_object"}
    assert "response_format" not in post.call_args_list[1].kwargs["json"]


def test_invalid_output_gets_a_repair_instruction_instead_of_an_identical_request() -> None:
    with patch("job_evidence_agent.model_client.httpx.post", side_effect=[completion("not-json"), completion(VALID_CONTENT)]) as post:
        result = OpenAICompatibleClient().assess_evidence(CONFIG, CLAIM, CANDIDATES)

    assert result.verdict == "partial"
    assert post.call_args_list[0].kwargs["json"]["messages"] != post.call_args_list[1].kwargs["json"]["messages"]


@pytest.mark.parametrize("content", [None, [], "", '{"verdict":"strong"}',
    '{"verdict":"unknown","links":[2],"rationale":"结论"}',
    '{"verdict":"partial","links":["2"],"rationale":"结论"}',
    '{"verdict":"partial","links":[true],"rationale":"结论"}',
    '{"verdict":"partial","links":[2],"rationale":"   "}',
    f"说明：{VALID_CONTENT}",
])
def test_missing_or_invalid_output_fails_safely_with_at_most_two_calls(content: object) -> None:
    with patch("job_evidence_agent.model_client.httpx.post", return_value=completion(content)) as post:
        with pytest.raises(ModelConnectionError, match="格式|字段|结构化"):
            OpenAICompatibleClient().assess_evidence(CONFIG, CLAIM, CANDIDATES)

    assert post.call_count == 2


def test_fallback_and_format_repair_share_one_two_request_budget() -> None:
    responses = [
        httpx.Response(422, json={"error": {"message": "unsupported response_format"}}),
        completion("not-json"),
    ]
    with patch("job_evidence_agent.model_client.httpx.post", side_effect=responses) as post:
        with pytest.raises(ModelConnectionError, match="格式|字段"):
            OpenAICompatibleClient().assess_evidence(CONFIG, CLAIM, CANDIDATES)

    assert post.call_count == 2


def test_json_code_fence_is_accepted_without_extracting_arbitrary_surrounding_prose() -> None:
    with patch("job_evidence_agent.model_client.httpx.post", return_value=completion(f"```json\n{VALID_CONTENT}\n```")):
        result = OpenAICompatibleClient().assess_evidence(CONFIG, CLAIM, CANDIDATES)

    assert result.links == (2,)


@pytest.mark.parametrize("body", [{}, {"choices": []}, {"choices": None}, None])
def test_malformed_completion_envelope_does_not_crash(body: object) -> None:
    with patch("job_evidence_agent.model_client.httpx.post", return_value=httpx.Response(200, json=body)) as post:
        with pytest.raises(ModelConnectionError, match="格式|字段|结构化"):
            OpenAICompatibleClient().assess_evidence(CONFIG, CLAIM, CANDIDATES)

    assert post.call_count == 2


def test_model_assessment_retries_invalid_json_once_then_returns_valid_verdict() -> None:
    responses = [
        httpx.Response(200, json={"choices": [{"message": {"content": "not-json"}}]}),
        httpx.Response(200, json={"choices": [{"message": {"content": '{"verdict":"partial","links":[2],"rationale":"代码包含相关实现"}'}}]}),
    ]
    claim = Claim(1, 1, "熟悉 FastAPI", "第 1 段", ("fastapi",), "pending_review")
    candidates = [EvidenceChunk(2, 3, "FastAPI 服务入口", "README", "zh")]

    with patch("job_evidence_agent.model_client.httpx.post", side_effect=responses) as post:
        assessment = OpenAICompatibleClient().assess_evidence(
            ModelConfig.create(base_url="https://api.example.com/v1", model_name="test", api_key="sk-x"),
            claim,
            candidates,
        )

    assert assessment.verdict == "partial"
    assert assessment.links == (2,)
    assert post.call_count == 2
