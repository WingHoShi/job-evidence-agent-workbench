from pathlib import Path


def test_compose_uses_a_configurable_non_conflicting_default_port() -> None:
    compose_text = Path("compose.yaml").read_text(encoding="utf-8")

    assert "127.0.0.1:${JOB_EVIDENCE_PORT:-8001}:8000" in compose_text
