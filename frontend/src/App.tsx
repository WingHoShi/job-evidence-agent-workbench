import { useEffect, useState } from "react";

import { ModelConfigStatus, SetupPage } from "./features/setup/SetupPage";
import { TaskWorkspace } from "./features/workbench/TaskWorkspace";

export default function App() {
  const [status, setStatus] = useState<ModelConfigStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      active = false;
      controller.abort();
      setFailed(true);
    }, 15000);
    void fetch("/api/setup/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("无法读取配置状态");
        }
        const body = await response.json();
        if (!body || typeof body.configured !== "boolean"
          || !(body.base_url === null || typeof body.base_url === "string")
          || !(body.model_name === null || typeof body.model_name === "string")) {
          throw new Error("配置状态格式异常");
        }
        return body as ModelConfigStatus;
      })
      .then((value) => { if (active) setStatus(value); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  if (!status) {
    return <main className="startup-screen">
      <div className="startup-brand"><strong>求职证据审计</strong><span>本地可追溯工作台</span></div>
      <section className="panel startup-card" role={failed ? "alert" : "status"} aria-labelledby="startup-title">
        <span className={`startup-indicator${failed ? " is-offline" : ""}`} aria-hidden="true" />
        <p className="eyebrow">{failed ? "连接未完成" : "启动检查"}</p>
        <h1 id="startup-title">{failed ? "暂时无法连接工作台" : "正在连接工作台"}</h1>
        <p className="startup-description">{failed
          ? "未能读取本机服务的配置状态，请确认工作台服务已启动后重试。"
          : "正在读取本机配置，完成后将自动进入。"}</p>
        {failed ? <>
          <p className="startup-hint">连接失败不代表配置丢失，无需重新填写 API Key。</p>
          <button type="button" className="primary-button" onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}>重新连接</button>
        </> : <p className="startup-hint">此步骤只读取配置状态，不会调用模型。</p>}
      </section>
    </main>;
  }

  if (!status.configured) {
    return <SetupPage onConfigured={setStatus} />;
  }

  return <TaskWorkspace />;
}
