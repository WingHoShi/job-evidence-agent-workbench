# 求职证据审计与模拟面试工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可通过 Docker Compose 本地运行的中文单用户工作台：审计简历既有主张的材料支持度，经逐条人工审核后输出岗位匹配报告，并提供文字版多轮模拟面试与统一复盘。

**Architecture:** React + TypeScript 前端由 FastAPI 托管；业务数据与 FTS5 证据索引保存在 SQLite，LangGraph checkpoint 使用独立 SQLite 文件。一个 LangGraph 审计图按“解析—主张—召回—证据判定—规则门禁—人工审核—报告”推进；面试图按“出题—回答—追问—结束复盘”推进。Docker Compose 仅运行应用服务，并将运行配置和数据持久化在宿主机挂载目录。

**Tech Stack:** Python 3.12、FastAPI、Pydantic、SQLite/FTS5、LangGraph、OpenAI 兼容 API、React 19、TypeScript、Vite、Vitest、pytest、Docker Compose。

**Spec:** 本计划依据当前对话中已确认的项目二需求；本文件是该需求的本地可执行记录。

## Global Constraints

- 仅简体中文；仅单机单用户；无账号、多租户或云端数据服务。
- 首次启动必须在界面配置并测试 OpenAI 兼容模型；真实 Key 不写入 SQLite、日志、前端状态或 Git。
- 仅支持用户手动输入：简历、JD、批量文件、粘贴文本与浏览器选择的本地项目目录；禁止 GitHub 抓取、招聘爬虫、自动投递、邮件或 Shell 工具。
- 一期不使用 Qdrant、Embedding、本地模型、语音输入、TTS、简历改写、PDF 导出、MCP 或 Supervisor 多 Agent。
- 证据结论只表示材料支持度，不验证现实经历真实性；没有独立证据时不得输出“可保留”的主张结论。
- 项目目录导入必须排除 `.git`、`.env`、依赖目录、构建产物、缓存、二进制、日志与模型文件。
- Docker Compose 从骨架阶段开始可启动；应用仅绑定 `127.0.0.1`，默认宿主机端口为 `8001`，可通过 `JOB_EVIDENCE_PORT` 调整。

---

## File Structure

- `backend/src/job_evidence_agent/`：FastAPI 应用、SQLite 仓储、模型配置、材料导入、FTS5 检索、规则门禁、LangGraph 工作流和 API 路由。
- `backend/tests/`：后端单元、工作流和 API 测试；使用假模型客户端，不调用真实 API。
- `frontend/src/`：配置向导、任务工作台、逐条审核、报告、面试和执行轨迹页面。
- `frontend/src/**/*.test.tsx`：前端交互测试。
- `examples/`：脱敏简历、JD、项目目录与人工标注验收用例；真实材料不进入仓库。
- `runtime-config/` 与 `data/`：仅本机运行时产生，必须忽略；前者存模型配置，后者存数据库、材料快照与工作流 checkpoint。
- `compose.yaml`、`Dockerfile`、`.env.example`、`README.md`：一键交付、配置与本地使用说明。

## Public Interfaces

- `GET /api/setup/status`：返回 `configured`、脱敏模型名与 Base URL；绝不返回 API Key。
- `POST /api/setup/test`：接收临时模型配置并执行无用户材料的连通性测试；测试失败不保存。
- `POST /api/setup/save`：再次验证后将配置写入挂载的运行配置文件。
- `POST /api/tasks`：创建任务，接收任务名、简历、JD 与初始文件来源。
- `POST /api/tasks/{task_id}/sources`：批量增加文档、粘贴文本或目录导入的文件；目录文件携带相对路径。
- `POST /api/tasks/{task_id}/audit`、`GET /api/tasks/{task_id}`、`POST /api/tasks/{task_id}/resume`：启动、查询和恢复审计图。
- `POST /api/claims/{claim_id}/review`：保存 `accept`、`edit`、`reject` 或 `supplement` 决定；补证只重跑该主张。
- `GET /api/tasks/{task_id}/report`、`GET /api/tasks/{task_id}/report.md`：查看或导出确认后的报告。
- `POST /api/tasks/{task_id}/interviews`、`POST /api/interviews/{session_id}/turns`、`POST /api/interviews/{session_id}/finish`：创建面试、提交回答、结束并生成复盘。

### Task 1: 项目骨架与可复现本地交付

**Files:**
- Create: `pyproject.toml`, `Dockerfile`, `compose.yaml`, `.dockerignore`, `.gitignore`, `.env.example`, `README.md`
- Create: `backend/src/job_evidence_agent/__init__.py`, `backend/src/job_evidence_agent/app.py`
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Test: `backend/tests/test_health.py`, `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: `create_app() -> FastAPI`，`GET /api/health -> {"status": "ok"}`。
- Produces: Compose 服务 `app`，端口映射为 `127.0.0.1:${JOB_EVIDENCE_PORT:-8001}:8000`，挂载 `./data` 和 `./runtime-config`。

- [x] 编写后端健康检查测试，断言 `GET /api/health` 返回 200 和 `{"status": "ok"}`。
- [~] 运行 `pytest backend/tests/test_health.py -q`，确认在应用未实现前失败（历史红灯过程无法追溯）。
- [x] 实现最小 FastAPI app factory、健康接口和静态前端挂载占位。
- [x] 编写前端根组件测试，断言未配置状态显示“初始化模型配置”。
- [x] 创建 Vite React 工程与最小根组件；实现 Docker 多阶段构建和 Compose 挂载目录。
- [x] 运行 `pytest backend/tests/test_health.py -q`、`npm --prefix frontend run test`、`npm --prefix frontend run build`，确认通过。
- [~] 运行 `docker compose up --build`，确认本机健康接口可访问；停止容器但保留数据卷（镜像已构建，运行态健康检查待最终交付验收）。
- [ ] 提交：`chore: 初始化求职证据工作台骨架`。

### Task 2: 本地模型配置向导与安全存储

**Files:**
- Create: `backend/src/job_evidence_agent/settings.py`, `backend/src/job_evidence_agent/model_client.py`, `backend/src/job_evidence_agent/routes/setup.py`
- Create: `frontend/src/features/setup/SetupPage.tsx`, `frontend/src/features/setup/SetupPage.test.tsx`
- Modify: `backend/src/job_evidence_agent/app.py`, `frontend/src/App.tsx`, `.env.example`, `README.md`
- Test: `backend/tests/test_setup.py`

**Interfaces:**
- Consumes: `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY`，保存在 `runtime-config/model.env`。
- Produces: `ModelConfigStatus(configured: bool, base_url: str | None, model_name: str | None)`。
- Produces: `OpenAICompatibleClient.test_connection(config) -> None`，失败时抛出可展示的受控错误。

- [x] 编写测试：无配置时 `/api/setup/status` 返回 `configured=false`；状态响应不含 API Key（日志不泄露尚无专门测试）。
- [x] 编写测试：测试连接失败不创建配置文件；成功保存后状态只包含脱敏 Base URL 和模型名。
- [x] 实现运行配置读取/原子写入、OpenAI 兼容客户端和连接测试；保存接口自行再次测试，不能信任前端测试结果。
- [x] 实现配置向导：Base URL、模型名、密码类型 Key 输入、测试连接、保存并进入工作台；未配置时屏蔽其他页面。
- [x] 运行 `pytest backend/tests/test_setup.py -q` 与前端设置页测试，确认通过。
- [ ] 提交：`feat: 增加本地模型配置向导`。

### Task 3: SQLite 业务仓储、材料快照与受限目录导入

**Files:**
- Create: `backend/src/job_evidence_agent/database.py`, `backend/src/job_evidence_agent/models.py`, `backend/src/job_evidence_agent/importing.py`, `backend/src/job_evidence_agent/routes/tasks.py`
- Create: `backend/src/job_evidence_agent/parsers/markdown.py`, `backend/src/job_evidence_agent/parsers/docx.py`, `backend/src/job_evidence_agent/parsers/pdf.py`, `backend/src/job_evidence_agent/parsers/text.py`
- Create: `frontend/src/features/tasks/NewTaskPage.tsx`
- Test: `backend/tests/test_database.py`, `backend/tests/test_importing.py`, `backend/tests/test_parsers.py`

**Interfaces:**
- Produces: `Task(id, name, resume_source_id, jd_source_id, status)`、`Source(id, task_id, kind, label, relative_path)`、`EvidenceChunk(id, source_id, text, locator, language)`。
- Produces: `import_sources(task_id, uploads) -> ImportSummary`，目录文件通过相对路径导入，真实本机绝对路径不入库。
- Produces: `allowed_file(relative_path, size_bytes) -> bool`，拒绝敏感/二进制/超限内容。

- [~] 编写数据库测试：创建任务、多个来源、片段和任务状态可持久化；重启仓储后能读取相同记录（`Task` 尚未保存专用的简历/JD 来源字段）。
- [x] 编写导入测试：`.env`、`.git/config`、`node_modules`、二进制和超限文件均被排除；`pyproject.toml`、`package.json`、`Dockerfile`、`.py`、`.ts`、`.tsx`、`.md` 可导入。
- [x] 编写解析测试：Markdown 标题、TXT、DOCX 与可复制文本 PDF 均生成带定位信息的文本片段；不可提取 PDF 返回可展示错误。
- [x] 实现 SQLite schema、运行数据目录、解析器、文件白名单、文件数/单文件/总文本限制和来源快照。
- [x] 实现创建任务与批量来源导入 API；前端提供一次任务内添加多个文件与多个目录来源的入口。
- [~] 运行上述后端测试和手动导入脱敏示例目录，确认数据库不保存真实绝对路径或排除文件内容（自动化安全测试已通过，脱敏示例目录留待 Task 8）。
- [ ] 提交：`feat: 支持任务材料与项目目录导入`。

### Task 4: FTS5 证据召回、主张抽取与确定性门禁

**Files:**
- Create: `backend/src/job_evidence_agent/taxonomy.py`, `backend/src/job_evidence_agent/retrieval.py`, `backend/src/job_evidence_agent/claims.py`, `backend/src/job_evidence_agent/gates.py`
- Modify: `backend/src/job_evidence_agent/database.py`, `backend/src/job_evidence_agent/model_client.py`
- Test: `backend/tests/test_retrieval.py`, `backend/tests/test_claims.py`, `backend/tests/test_gates.py`

**Interfaces:**
- Produces: `Claim(id, task_id, text, resume_locator, capability_tags, status)`。
- Produces: `EvidenceAssessment(claim_id, links, verdict, rationale)`，`verdict` 仅能为 `strong`、`partial`、`none`、`conflict`。
- Produces: `GateDecision(eligible, requires_review, reason)`；`none` 必须 `eligible=false`，`conflict` 必须 `requires_review=true`。

- [x] 编写 FTS5 测试：用“BM25 + RRF”主张召回 README/代码中的相关片段，不召回无关文件。
- [x] 编写主张抽取测试：只从简历片段输出主张与能力标签，不得从项目材料生成新增主张。
- [x] 编写门禁测试：仅简历自述、无证据、部分代码证据、指标冲突、强证据五种样例得到预期决定。
- [x] 实现固定 AI 应用开发能力词典、代码标识符规范化、FTS5 BM25 召回和候选上限。
- [x] 实现模型结构化判定：模型只接收候选片段；Pydantic 校验失败后重试一次；不得将代码存在推断为个人负责或生产部署。
- [x] 实现确定性门禁，不由模型直接决定最终可用性。
- [x] 运行 `pytest backend/tests/test_retrieval.py backend/tests/test_claims.py backend/tests/test_gates.py -q`，确认通过（最终全量后端测试为 38 passed）。
- [ ] 提交：`feat: 增加可追溯证据审计`。

> 已接入：前端主张审核卡片展示模型结构化结论、候选证据和确定性门禁结果；用户主动触发判定后再逐条人工确认/拒绝，避免批量消耗模型 Token。

### Task 5: LangGraph 审计工作流、人工审核与恢复

**Files:**
- Create: `backend/src/job_evidence_agent/workflows/audit.py`, `backend/src/job_evidence_agent/workflows/checkpoints.py`, `backend/src/job_evidence_agent/routes/audit.py`
- Create: `frontend/src/features/audit/AuditPage.tsx`, `frontend/src/features/audit/ClaimReviewCard.tsx`
- Test: `backend/tests/test_audit_workflow.py`, `backend/tests/test_audit_api.py`, `frontend/src/features/audit/ClaimReviewCard.test.tsx`

**Interfaces:**
- Produces: audit 状态 `created | parsing | auditing | awaiting_review | completed | failed | recoverable`。
- Produces: `POST /api/claims/{claim_id}/review`，输入 `decision`、可选 `edited_text`、可选补充片段；输出当前与下一条待审核主张。
- Produces: `GET /api/tasks/{task_id}`，返回任务状态、当前审核项、事件轨迹和可恢复信息。

- [~] 编写工作流测试：每个主张按顺序暂停、接受后进入下一条、补证保持当前主张；拒绝路径已有实现但仍需补充专门回归测试。
- [x] 编写恢复测试：在第 N 条主张审核后重新创建应用实例，任务显示 `awaiting_review` 并能从同一条继续。
- [x] 实现独立 `workflow.db` 的 SQLite checkpointer、LangGraph 审计推进节点、条件边和任务事件写入。
- [x] 实现逐条审核 UI，展示原主张、候选证据、支持程度、门禁结论、风险、接受/编辑/拒绝/补证操作与执行轨迹（当前不自动轮询，判定由用户按需触发）。
- [x] 运行工作流与 API 测试，确认不依赖真实模型 API。
- [ ] 提交：`feat: 增加可恢复的人工证据审核流程`。

### Task 6: 报告与 Markdown 导出

**Files:**
- Create: `backend/src/job_evidence_agent/reporting.py`, `backend/src/job_evidence_agent/routes/reports.py`
- Create: `frontend/src/features/reports/ReportPage.tsx`
- Test: `backend/tests/test_reporting.py`, `frontend/src/features/reports/ReportPage.test.tsx`

**Interfaces:**
- Produces: `Report(task_id, generated_at, confirmed_claims, insufficient_claims, conflicts, jd_coverage, next_steps)`。
- Produces: `GET /api/tasks/{task_id}/report` 与 `/report.md`；未完成全部审核返回 409，且不生成半成品正式报告。

- [x] 编写报告测试：仅含用户确认结论；每条结论带来源定位；无证据主张归入“材料不足”而非能力标签。
- [x] 编写导出测试：Markdown 不含 API Key、真实绝对路径、内部模型推理或被排除文件内容。
- [x] 实现报告汇总、页面展示与 UTF-8 Markdown 下载；报告不输出总匹配分。
- [x] 运行报告后端和前端测试，使用脱敏示例材料核验来源链接与文字分类。
- [ ] 提交：`feat: 增加岗位匹配报告与 Markdown 导出`。

### Task 7: 文字版多轮模拟面试与统一复盘

**Files:**
- Create: `backend/src/job_evidence_agent/workflows/interview.py`, `backend/src/job_evidence_agent/routes/interviews.py`
- Create: `frontend/src/features/interview/InterviewSetup.tsx`, `frontend/src/features/interview/InterviewPage.tsx`, `frontend/src/features/interview/InterviewReviewPage.tsx`
- Test: `backend/tests/test_interview_workflow.py`, `backend/tests/test_interview_api.py`, `frontend/src/features/interview/InterviewPage.test.tsx`

**Interfaces:**
- Produces: `InterviewSession(id, task_id, mode, question_count, focus_areas, status)` 与 `InterviewTurn(question, answer, evidence_ids)`。
- Produces: `POST /api/tasks/{task_id}/interviews`、`POST /api/interviews/{session_id}/turns`、`POST /api/interviews/{session_id}/finish`。
- Requires: 任务报告已完成；面试回答不会写入 `EvidenceChunk` 或 `EvidenceLink`。

- [x] 编写测试：未完成审计的任务不能开始面试；默认综合模式可启动；进阶模式接受时长、题数和侧重点。
- [x] 编写测试：提交回答只返回下一题或追问，不返回即时评分；结束接口生成含一致性、遗漏、技术缺口与下一步建议的复盘。
- [x] 实现面试 LangGraph 状态、逐回合持久化、基于已确认主张/JD/证据的题目与追问生成、结束复盘。
- [x] 实现默认综合模拟与高级设置页面、逐题聊天界面、主动结束按钮和复盘页面。
- [x] 运行工作流、API 和前端测试，确认回答不能自动成为后续审计证据。
- [ ] 提交：`feat: 增加文字模拟面试与复盘`。

### Task 8: 脱敏示例、评测与交付验收

**Files:**
- Create: `examples/resume.md`, `examples/jd.md`, `examples/projects/`, `examples/evaluation_cases.jsonl`
- Create: `backend/tests/test_acceptance_cases.py`, `docs/demo-script.md`
- Modify: `README.md`, `.gitignore`, `compose.yaml`

**Interfaces:**
- Produces: 四类可重复验收样例：充分支持、材料不足、材料冲突、补证后恢复。
- Produces: Docker 新环境验收步骤和 Demo 脚本。

- [x] 编写验收测试：每个脱敏样例的预期 verdict、门禁结果和审核后状态均固定。
- [x] 编写安全验收：导入包含提示注入文本时，系统仅将其作为材料；模型不能获得未授权工具或执行外部操作。
- [x] 创建脱敏示例简历、JD、两个小型项目目录与 JSONL 期望结果；不放入任何真实姓名、联系方式、API Key、真实项目源码或实习资料。
- [x] 完善 README：Docker 启动、首次模型配置、材料隐私、目录导入边界、任务恢复、测试命令与故障排查。
- [x] 运行完整后端测试、前端测试、前端构建与 `docker compose up --build`；四类示例验收通过，隔离 Compose 容器健康接口返回 `{"status":"ok"}` 后已清理容器与网络。
- [~] 检查 `git status`，仅暂存源码、测试、示例和文档；项目目录尚未初始化为 Git 仓库，无法执行此项检查。
- [ ] 提交：`feat: 完成可复现的求职证据工作台交付`。

## Plan Self-Review

- 覆盖性：配置、单机部署、材料与目录导入、FTS5、证据门禁、LangGraph 恢复、逐条审核、报告、文字面试、执行轨迹、示例、测试和隐私限制均有对应任务。
- 边界：未加入向量库、Embedding、GitHub 读取、语音、TTS、简历改写、PDF、自动投递、外部副作用或多 Agent。
- 数据一致性：`Claim`、`EvidenceChunk`、`EvidenceAssessment`、`GateDecision`、`InterviewSession` 的生产与使用顺序已在任务接口中固定。
