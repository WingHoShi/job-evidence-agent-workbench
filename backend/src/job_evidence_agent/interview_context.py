"""冻结合规背景、控制输入成本并确定本题话题。"""

import re

from job_evidence_agent.interview_contracts import (
    ClaimSnapshot, EvidenceSnapshot, InterviewSnapshot, QuestionInput, QuestionTarget, ReviewInput,
)
from job_evidence_agent.reporting import build_report, _keywords, _safe_text
from job_evidence_agent.retrieval import retrieve_evidence


def build_interview_snapshot(repository, task_id):
    report = build_report(repository, task_id)
    sources = repository.list_sources(task_id)
    legal = {chunk.id: (source, chunk) for source in sources if source.kind in {"project", "supplement"} for chunk in repository.list_chunks(source.id)}
    claims = []
    truncated = False
    for review in report.claim_reviews:
        if review.review_status != "人工已接受":
            continue
        candidates = list(dict.fromkeys([item.chunk_id for item in review.evidence] + [item.id for item in retrieve_evidence(repository, task_id, review.text)]))
        evidence = []
        for chunk_id in candidates[:3]:
            if chunk_id not in legal:
                continue
            source, chunk = legal[chunk_id]
            text = _safe_text(chunk.text)
            truncated |= len(text) > 1200
            evidence.append(EvidenceSnapshot(id=chunk_id, text=text[:1200], kind=source.kind, locator=_safe_text(chunk.locator), label=_safe_text(source.label), relative_path=_safe_text(source.relative_path)))
        claims.append(ClaimSnapshot(id=review.claim_id, text=review.text, verdict=review.verdict, risk=review.risk, rationale=review.rationale, tags=sorted(_keywords(review.text)), evidence=evidence))
    jd = "\n".join(_safe_text(chunk.text) for source in sources if source.kind == "job_description" for chunk in repository.list_chunks(source.id))
    return InterviewSnapshot(claims=claims, jd=jd[:4000], truncated=truncated or len(jd) > 4000)


def select_question_target(snapshot, turns, question_count):
    if len(turns) >= question_count or not snapshot.claims:
        raise ValueError("已达到题数或没有可面试主张")
    if turns and turns[-1].kind == "main" and turns[-1].answer is not None:
        return QuestionTarget(claim_id=turns[-1].claim_id, kind="followup", followup_of_turn_id=turns[-1].id)
    covered = {turn.claim_id for turn in turns}
    ranked = sorted(enumerate(snapshot.claims), key=lambda pair: (-bool(_keywords(pair[1].text) & _keywords(snapshot.jd)), -(pair[1].risk != "低"), pair[0]))
    fresh = [claim for _, claim in ranked if claim.id not in covered]
    if fresh:
        claim = fresh[0]
    else:
        counts = {claim.id: sum(turn.claim_id == claim.id for turn in turns) for claim in snapshot.claims}
        claim = min((claim for _, claim in ranked), key=lambda item: counts[item.id])
    return QuestionTarget(claim_id=claim.id, kind="main")


def _fit_budget(context, limit):
    result = context.model_copy(deep=True)
    result.truncated = result.truncated or result.snapshot.truncated
    if len(result.model_dump_json()) <= limit:
        return result
    result.truncated = True
    # 先缩减证据，不碰当前回答、主张风险与话题关联。
    for claim in result.snapshot.claims:
        for evidence in claim.evidence:
            evidence.text = evidence.text[:300]
    if len(result.model_dump_json()) > limit:
        for claim in result.snapshot.claims:
            claim.evidence = []
    if len(result.model_dump_json()) > limit:
        result.snapshot.jd = result.snapshot.jd[:1000]
    if len(result.model_dump_json()) > limit and isinstance(result, QuestionInput):
        for turn in result.turns[:-1]:
            if turn.answer:
                turn.answer = turn.answer[:200] + "[较早回答已缩减]"
    if len(result.model_dump_json()) > limit:
        raise ValueError("必要上下文超过预算，请减少主张或材料长度；当前回答未丢弃")
    return result


def build_question_input(snapshot, turns, target):
    relevant = snapshot.model_copy(deep=True)
    relevant.claims = [claim for claim in relevant.claims if claim.id == target.claim_id]
    answers = [turn.answer for turn in turns if turn.answer is not None]
    # 保守匹配明确自述，不用短回答长度推断能力，也不执行回答中的指令。
    latest = answers[-1] if answers else ""
    basic_request = bool(re.fullmatch(r"(?:这个扩展设计我还不会[，,]?)?(?:我)?(?:希望|想|请)(?:先)?问(?:一些)?基础(?:问题|题)[。.!！]?", latest.strip()))
    unable = re.compile(r"(?:(?:这个|这题|这部分)(?:我)?|我)?(?:也)?(?:确实)?(?:是)?(?:不太清楚|不清楚|不知道|不太会|不会|还不会)(?:[，,]我没学过)?[。.!！]?")
    consecutive = len(answers) >= 2 and all(unable.fullmatch(answer.strip()) for answer in answers[-2:])
    hint = "foundation" if basic_request or consecutive else "default"
    return _fit_budget(QuestionInput(snapshot=relevant, turns=turns, target=target, ordinal=len(turns)+1, difficulty_hint=hint), 20000)


def build_review_input(snapshot, turns):
    return _fit_budget(ReviewInput(snapshot=snapshot, turns=turns), 30000)


def validate_question(value, context):
    if (value.claim_id, value.kind, value.followup_of_turn_id) != (context.target.claim_id, context.target.kind, context.target.followup_of_turn_id):
        raise ValueError("题目主张或追问关联不一致")
    allowed = {e.id for claim in context.snapshot.claims for e in claim.evidence}
    if not set(value.evidence_ids) <= allowed or len(value.evidence_ids) != len(set(value.evidence_ids)):
        raise ValueError("题目引用不在白名单")


def validate_review(value, context):
    answered = {turn.id for turn in context.turns if turn.answer is not None}
    ids = [item.turn_id for item in value.turn_reviews]
    if set(ids) != answered or len(ids) != len(answered):
        raise ValueError("逐题复盘必须覆盖全部已回答回合")
    claims = {claim.id for claim in context.snapshot.claims}
    evidence = {item.id for claim in context.snapshot.claims for item in claim.evidence}
    for item in value.turn_reviews:
        if not set(item.evidence_ids) <= evidence:
            raise ValueError("复盘引用不在白名单")
    for item in value.consistency + value.answer_consistency + value.omissions + value.technical_gaps + value.next_steps:
        if not set(item.turn_ids) <= answered or not set(item.claim_ids) <= claims or not set(item.evidence_ids) <= evidence:
            raise ValueError("复盘引用不在白名单")
