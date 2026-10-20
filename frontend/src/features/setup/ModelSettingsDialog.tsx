import { FormEvent, useEffect, useRef, useState } from "react";
import { ModelConfigStatus } from "./SetupPage";

function readStatus(body: unknown): ModelConfigStatus {
  const value = body as ModelConfigStatus | null;
  if (!value || typeof value.configured !== "boolean"
    || !(value.base_url === null || typeof value.base_url === "string")
    || !(value.model_name === null || typeof value.model_name === "string")) throw new Error("invalid status");
  return value;
}

export function ModelSettingsDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState<ModelConfigStatus | null>(null);
  const [form, setForm] = useState({ base_url: "", model_name: "", api_key: "" });
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);

  useEffect(() => {
    closeButton.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      active = false; controller.abort(); setLoadError(true);
    }, 15000);
    void fetch("/api/setup/status", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("status unavailable");
      const status = readStatus(await response.json());
      if (active) {
        setCurrent(status);
        setForm({ base_url: status.base_url ?? "", model_name: status.model_name ?? "", api_key: "" });
      }
    }).catch(() => { if (active) setLoadError(true); }).finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [reload]);

  const complete = Boolean(form.base_url.trim() && form.model_name.trim() && form.api_key.trim());
  const request = async (kind: "test" | "save") => {
    if (!complete || lock.current) return;
    lock.current = true; setBusy(kind); setMessage(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(kind === "test" ? "/api/setup/test" : "/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form), signal: controller.signal,
      });
      if (!response.ok) {
        setMessage({ error: true, text: kind === "test"
          ? "连接测试未通过，请检查接口地址、模型名称、密钥权限和账户额度。"
          : "保存未通过，请检查配置后重试；如需确认当前配置，可关闭后重新打开设置。" });
        return;
      }
      const status = readStatus(await response.json());
      if (!status.configured) throw new Error("configuration not confirmed");
      if (kind === "save") {
        setCurrent(status);
        setForm({ base_url: status.base_url ?? "", model_name: status.model_name ?? "", api_key: "" });
      }
      setMessage({ error: false, text: kind === "test" ? "连接测试通过，尚未保存。" : "配置已保存，后续模型请求使用此配置。" });
    } catch {
      setMessage({ error: true, text: kind === "save"
        ? "未确认保存结果，请关闭后重新打开设置，核对当前配置；不要连续重复保存。"
        : "连接测试未完成，请检查工作台服务和网络后重试；本次测试不保存配置。" });
    } finally { window.clearTimeout(timer); lock.current = false; setBusy(null); }
  };

  return <div className="model-settings-overlay">
    <section className="model-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="model-settings-title" aria-describedby="model-settings-description" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!lock.current) onClose(); }
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="model-settings-header"><div><p className="eyebrow">工作台设置</p><h2 id="model-settings-title">模型设置</h2></div>
        <button ref={closeButton} className="model-settings-close" aria-label="关闭设置" type="button" disabled={Boolean(busy)} onClick={onClose}>关闭</button></header>
      <p id="model-settings-description" className="model-settings-intro">接入你自己的 OpenAI 兼容聊天接口，费用由对应服务商收取。</p>
      {loadError ? <div className="model-settings-load-error"><p role="alert">无法读取当前配置，请确认工作台服务已启动后重试。</p><button className="interview-button" type="button" onClick={() => { setLoadError(false); setReload((value) => value + 1); }}>重新读取</button></div>
        : !current ? <p role="status" className="muted-copy">正在读取当前配置…</p> : <>
          <section className="model-settings-current" aria-label="当前生效配置"><span>{current.configured ? "当前生效" : "尚未配置"}</span><strong>{current.model_name ?? "未设置模型"}</strong><p>{current.base_url ?? "保存后即可接入模型服务"}</p></section>
          <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void request("save"); }}>
            <fieldset disabled={Boolean(busy)}>
              <label htmlFor="model-settings-url">Base URL</label><input id="model-settings-url" type="url" required value={form.base_url} placeholder="https://api.example.com/v1" onChange={(event) => { setForm({ ...form, base_url: event.target.value }); setMessage(null); }} />
              <p className="model-settings-field-hint">填写接口基础地址，不要包含 /chat/completions。</p>
              <label htmlFor="model-settings-name">模型名称</label><input id="model-settings-name" required value={form.model_name} placeholder="填写你账户可调用的模型名称" onChange={(event) => { setForm({ ...form, model_name: event.target.value }); setMessage(null); }} />
              <label htmlFor="model-settings-key">API Key</label><input id="model-settings-key" type="password" autoComplete="off" required value={form.api_key} placeholder="请输入此配置对应的 API Key" onChange={(event) => { setForm({ ...form, api_key: event.target.value }); setMessage(null); }} />
              <p className="model-settings-field-hint">不回显旧密钥；测试或保存时需重新输入。密钥只保存在本机后端，不写入浏览器存储。</p>
            </fieldset>
            <div className="model-settings-notice"><p>测试连接与保存配置各会发送一次验证请求，可能产生费用。测试成功不会自动保存。</p><p>网页订阅或 Coding Plan 不一定包含 API 额度。保存后影响后续请求，不修改已有任务、回答和复盘。</p></div>
            {message ? <p role={message.error ? "alert" : "status"} className={`model-settings-feedback${message.error ? " is-error" : ""}`}>{message.text}</p> : null}
            <footer className="model-settings-actions"><button className="interview-button" type="button" disabled={Boolean(busy) || !complete} onClick={() => void request("test")}>{busy === "test" ? "正在测试…" : "测试连接"}</button><button className="primary-button" type="submit" disabled={Boolean(busy) || !complete}>{busy === "save" ? "验证并保存中…" : "保存配置"}</button></footer>
          </form>
        </>}
    </section>
  </div>;
}
