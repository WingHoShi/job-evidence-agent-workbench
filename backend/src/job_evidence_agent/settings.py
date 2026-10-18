"""运行时模型配置的校验与本地持久化。"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


@dataclass(frozen=True)
class ModelConfig:
    base_url: str
    model_name: str
    api_key: str

    @classmethod
    def create(cls, *, base_url: str, model_name: str, api_key: str) -> "ModelConfig":
        normalized_base_url = base_url.strip().rstrip("/")
        parsed_url = urlparse(normalized_base_url)

        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise ValueError("Base URL 必须是完整的 http 或 https 地址")
        if parsed_url.username or parsed_url.password or parsed_url.query or parsed_url.fragment:
            raise ValueError("Base URL 不能包含账号、查询参数或片段")
        if not model_name.strip():
            raise ValueError("请填写模型名")
        if not api_key.strip():
            raise ValueError("请填写 API Key")
        if any("\n" in value or "\r" in value for value in (base_url, model_name, api_key)):
            raise ValueError("配置内容不能包含换行符")

        return cls(
            base_url=normalized_base_url,
            model_name=model_name.strip(),
            api_key=api_key.strip(),
        )


@dataclass(frozen=True)
class ModelConfigStatus:
    configured: bool
    base_url: str | None
    model_name: str | None


class ModelConfigStore:
    def __init__(self, config_path: Path | None = None) -> None:
        self.config_path = config_path or Path(
            os.environ.get("JOB_EVIDENCE_CONFIG_PATH", "runtime-config/model.env")
        )

    def get(self) -> ModelConfig | None:
        if not self.config_path.is_file():
            return None

        values = self._read_values()
        try:
            return ModelConfig.create(
                base_url=values["MODEL_BASE_URL"],
                model_name=values["MODEL_NAME"],
                api_key=values["MODEL_API_KEY"],
            )
        except (KeyError, ValueError):
            return None

    def status(self) -> ModelConfigStatus:
        config = self.get()
        if config is None:
            return ModelConfigStatus(False, None, None)
        return ModelConfigStatus(True, config.base_url, config.model_name)

    def save(self, config: ModelConfig) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        content = "\n".join(
            (
                f"MODEL_BASE_URL={json.dumps(config.base_url)}",
                f"MODEL_NAME={json.dumps(config.model_name)}",
                f"MODEL_API_KEY={json.dumps(config.api_key)}",
                "",
            )
        )
        temporary_path = self.config_path.with_name(
            f".{self.config_path.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            temporary_path.write_text(content, encoding="utf-8")
            os.replace(temporary_path, self.config_path)
        finally:
            if temporary_path.exists():
                temporary_path.unlink()

    def _read_values(self) -> dict[str, str]:
        values: dict[str, str] = {}
        for line in self.config_path.read_text(encoding="utf-8").splitlines():
            if not line or line.lstrip().startswith("#") or "=" not in line:
                continue
            key, raw_value = line.split("=", maxsplit=1)
            try:
                values[key.strip()] = json.loads(raw_value)
            except json.JSONDecodeError:
                values[key.strip()] = raw_value.strip()
        return values
