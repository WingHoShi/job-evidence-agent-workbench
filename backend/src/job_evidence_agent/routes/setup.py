"""初始化模型配置的 HTTP 接口。"""

from __future__ import annotations

from typing import Protocol

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from job_evidence_agent.model_client import ModelConnectionError, OpenAICompatibleClient
from job_evidence_agent.settings import ModelConfig, ModelConfigStore, ModelConfigStatus


class ModelClient(Protocol):
    def test_connection(self, config: ModelConfig) -> None: ...


class SetupRequest(BaseModel):
    base_url: str
    model_name: str
    api_key: str


def create_setup_router(
    *, config_store: ModelConfigStore, model_client: ModelClient | None = None
) -> APIRouter:
    router = APIRouter(prefix="/api/setup", tags=["setup"])
    connection_client = model_client or OpenAICompatibleClient()

    def build_config(request: SetupRequest) -> ModelConfig:
        try:
            return ModelConfig.create(
                base_url=request.base_url,
                model_name=request.model_name,
                api_key=request.api_key,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @router.get("/status", response_model=ModelConfigStatus)
    def get_status() -> ModelConfigStatus:
        return config_store.status()

    @router.post("/test", response_model=ModelConfigStatus)
    def test_connection(request: SetupRequest) -> ModelConfigStatus:
        config = build_config(request)
        try:
            connection_client.test_connection(config)
        except ModelConnectionError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return ModelConfigStatus(True, config.base_url, config.model_name)

    @router.post("", response_model=ModelConfigStatus)
    def save_setup(request: SetupRequest) -> ModelConfigStatus:
        config = build_config(request)
        try:
            connection_client.test_connection(config)
        except ModelConnectionError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        config_store.save(config)
        return config_store.status()

    return router
