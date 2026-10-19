# 部署、初始化与数据恢复

[返回项目首页](../README.md) · [工作台使用指南](usage.md)

本文描述可迁移的本地部署流程，不包含开发者个人电脑路径、历史镜像 ID、真实任务或密钥。应用面向单用户自托管，没有公网多租户鉴权；Compose 默认只绑定 `127.0.0.1`，不要直接改为公网暴露。

## 文件与存储

- `data/workbench.sqlite3`：任务、材料、主张、报告和面试数据。
- `data/workflow.db`：审计工作流的自定义 SQLite 检查点与事件。
- `runtime-config/model.env`：模型地址、名称和 API Key，必须按秘密文件保护。
- Compose 默认把宿主机 `./data`、`./runtime-config` 挂载到容器 `/app/data`、`/app/runtime-config`。配置过 `JOB_EVIDENCE_DATA_DIR` / `JOB_EVIDENCE_CONFIG_DIR` 时，先核实实际目录。

数据与容器分离。普通 `docker compose down` 不删除上述宿主机目录，但手动删除目录或恢复旧备份会影响数据。备份包含导入材料、会话和密钥，不应上传公开仓库、网盘或作为演示附件。

## 首次安装

Windows 可按 [Docker Desktop 官方说明](https://docs.docker.com/desktop/setup/install/windows-install/) 安装并打开软件，等待 Linux 容器引擎就绪。基础镜像使用 DaoCloud Docker Hub 加速地址，首次构建需要网络；不可访问时检查来源与网络，不改用未知镜像。

在项目根目录运行，确保 Docker 已就绪；该流程会新建本地数据与配置目录：

```powershell
docker compose up -d --build
docker compose ps
```

等待 <http://127.0.0.1:8001/api/health> 正常，确认宿主机业务数据库已建立。健康响应仅证明服务入口可用，不证明真实模型或面试流程已通过。

新版面试表需要显式初始化。先停止应用，避免迁移时并发写入：

```powershell
docker compose stop app
docker compose run --rm --no-deps app python -m job_evidence_agent.migrate_interviews --database /app/data/workbench.sqlite3 --backup-dir /app/data/backups
```

迁移命令先检查目标是工作台业务数据库，再用 SQLite backup API 生成一致性副本、检查备份完整性，最后创建新版面试表。数据库不存在时拒绝创建空库；失败时不要继续启动或删除库，先检查输出。每次运行会新建备份，不覆盖旧副本。

仅迁移成功后继续：

```powershell
docker compose up -d --no-build app
```

访问 <http://127.0.0.1:8001>，通过页面配置自己的模型服务。测试连接和保存配置都会发起真实短请求，可能计费。先用 `examples/` 中的虚构资料体验，不上传真实个人或内部材料。

## 有数据的升级

不要照搬“首次安装”当作无风险升级；按实际数据量安排停机与备份：

1. 确认运行镜像、实际挂载目录和当前版本，保留旧镜像以供回退，不输出模型配置正文。
2. `docker compose build app` 先构建新镜像，不替换运行容器；失败时保留原服务。
3. 停止应用，将完整 `data` 和 `runtime-config` 复制到项目外新目录，核对文件和校验和。只复制正在写入的 SQLite 主文件不等于一致备份。
4. 仅在版本需要时运行上述迁移命令；无结构变更不必重复迁移。CLI 自动生成的业务库备份不能替代完整配置与工作流备份。
5. 迁移成功后执行 `docker compose up -d --no-build app`，核对版本、页面资源、任务、已保存回答和引用。
6. 经确认模型费用后，再用虚构任务验证完整业务链路，不对真实任务自动发送写请求。

## 回退与验证

回退代码和回退数据不是一回事。若必须恢复旧备份，先停止服务、另存当前数据，明确备份之后新增记录可能丢失；不要直接覆盖当前现场。业务库、工作流库和配置要使用对应的一套备份，并运行匹配的旧镜像。具体恢复前应人工确认路径与数据取舍。

最小验收包括：导入示例 → 逐条审核 → 报告及引用 → 面试回答 → 下一题失败时保留答案 → 复盘保存 → 刷新恢复。HTTP 200、生产构建或模拟测试单独通过，都不能代替真实模型语义与完整交互验收。

## 本地配置与公开文件

Git 和构建上下文均应排除运行目录、缓存、浏览器配置和密钥。`examples/projects/prompt-injection-demo/.env` 是唯一刻意保留在 Git 候选中的虚构 `.env` 测试夹具，用于测试导入跳过规则；不要用真实密钥替换它。该样例目录不会进入 Docker 构建上下文。

个人部署流水记录保留本机，不作为公共运行文档；公开入口为本文件与项目 README。没有另行选择许可证前，不自动添加许可证或改写第三方授权说明。

个人 `Career Studio` 快捷方式、启动脚本与图标没有随公共仓库发布，也不是安装依赖。下载仓库的用户应使用本文的 Compose 或原生开发流程；不要寻找只在开发者电脑存在的入口。

## 日常维护与端口

在原项目目录使用原配置操作，避免误连不同数据目录：

```powershell
docker compose stop app
docker compose start app
docker compose ps
docker compose logs --tail 100 app
```

关闭浏览器不会停止服务。删除容器不等于删除宿主机挂载目录，但删除或覆盖 `data/`、`runtime-config/` 会影响任务与配置。

默认端口为 8001。首次安装前可在 PowerShell 设置 `$env:JOB_EVIDENCE_PORT = "8011"`；后续 Compose 命令需沿用相同端口配置。确认浏览器访问的是对应实例，不要把不同地址上的记录混为一谈。

## 原生开发

前提为 Python 3.12+、Node.js 22 和 npm。以下命令从项目根目录执行，使用清华 PyPI 镜像与 npmmirror：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]" --index-url https://pypi.tuna.tsinghua.edu.cn/simple
npm --prefix frontend ci --registry=https://registry.npmmirror.com
npm --prefix frontend run build
.\.venv\Scripts\uvicorn.exe job_evidence_agent.app:app --host 127.0.0.1 --port 8001
```

后端提供已构建的 `frontend/dist`，页面和 `/api` 同源。当前 Vite 配置没有 API 代理，单独运行 `npm run dev` 不保证前后端联通。若 Docker 已占用 8001，不要再同时启动相同端口的开发服务。

首次启动建立业务库后，在服务终端按 Ctrl+C 停止，初始化面试表：

```powershell
.\.venv\Scripts\python.exe -m job_evidence_agent.migrate_interviews --database data/workbench.sqlite3 --backup-dir data/backups
```

仅迁移成功后再启动 Uvicorn。迁移会先检查和备份业务库，不存在的数据库不会被创建为空库。不要指向其他项目的数据文件。

## 隔离演示实例

若要与已有实例并存，必须同时使用**独立 Compose 项目名、数据目录、配置目录和未占用端口**。只改数据目录但沿用项目名，仍可能替换现有容器。

```powershell
$env:JOB_EVIDENCE_DATA_DIR = ".acceptance-data"
$env:JOB_EVIDENCE_CONFIG_DIR = ".acceptance-runtime-config"
$env:JOB_EVIDENCE_PORT = "8011"
docker compose -p job-evidence-demo up -d --build
```

选择未占用的端口，访问相应地址（例中为 `http://127.0.0.1:8011`）。按“首次安装”初始化面试表时，所有 Compose 命令都必须加入 `-p job-evidence-demo` 并保留上述环境配置；不要对默认项目执行停止或迁移。

演示结束使用 `docker compose -p job-evidence-demo down` 停止该实例，不删除挂载目录。目录仍可能包含密钥和虚构任务；删除或备份前先核对范围。完成后另开终端再操作原实例，避免沿用演示环境变量。

## 开发验证命令

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m pytest backend/tests/test_acceptance_cases.py -q
npm --prefix frontend run test
npm --prefix frontend run build
```

以上模拟测试与构建不能替代真实模型和浏览器完整业务验收。真实调用先确认费用与资料范围，使用虚构材料；不把健康响应或测试通过描述成经历、能力或答案准确率的认证。
