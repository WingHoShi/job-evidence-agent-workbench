# 部署、初始化与数据恢复

本文描述可迁移的本地部署流程，不包含开发者个人电脑路径、历史镜像 ID、真实任务或密钥。应用面向单用户自托管，没有公网多租户鉴权；Compose 默认只绑定 `127.0.0.1`，不要直接改为公网暴露。

## 文件与存储

- `data/workbench.sqlite3`：任务、材料、主张、报告和面试数据。
- `data/workflow.db`：审计工作流的自定义 SQLite 检查点与事件。
- `runtime-config/model.env`：模型地址、名称和 API Key，必须按秘密文件保护。
- Compose 默认把宿主机 `./data`、`./runtime-config` 挂载到容器 `/app/data`、`/app/runtime-config`。配置过 `JOB_EVIDENCE_DATA_DIR` / `JOB_EVIDENCE_CONFIG_DIR` 时，先核实实际目录。

数据与容器分离。普通 `docker compose down` 不删除上述宿主机目录，但手动删除目录或恢复旧备份会影响数据。备份包含导入材料、会话和密钥，不应上传公开仓库、网盘或作为演示附件。

## 首次安装

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
