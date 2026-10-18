import { FormEvent, useState } from "react";

export type ModelConfigStatus = {
  configured: boolean;
  base_url: string | null;
  model_name: string | null;
};

type SetupPageProps = {
  onConfigured: (status: ModelConfigStatus) => void;
};

type SetupForm = {
  base_url: string;
  model_name: string;
  api_key: string;
};

const initialForm: SetupForm = {
  base_url: "",
  model_name: "",
  api_key: "",
};

async function readResponse(response: Response): Promise<ModelConfigStatus> {
  const body = (await response.json()) as ModelConfigStatus | { detail?: string };
  if (!response.ok) {
    throw new Error("detail" in body ? body.detail || "配置请求失败，请稍后重试" : "配置请求失败，请稍后重试");
  }
  return body as ModelConfigStatus;
}

export function SetupPage({ onConfigured }: SetupPageProps) {
  const [form, setForm] = useState<SetupForm>(initialForm);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = (field: keyof SetupForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      onConfigured(await readResponse(response));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置请求失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const testConnection = async () => {
    setIsSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/setup/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      await readResponse(response);
      setMessage("连接测试通过。保存后即可进入工作台。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "连接测试失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main>
      <h1>初始化模型配置</h1>
      <p>请填写 OpenAI 兼容模型的信息。系统会先测试连接，保存时会再次验证。</p>
      <form onSubmit={submit}>
        <p>
          <label htmlFor="base-url">Base URL</label>
          <input
            id="base-url"
            name="base_url"
            type="url"
            value={form.base_url}
            onChange={(event) => updateField("base_url", event.target.value)}
            placeholder="https://api.example.com/v1"
            required
          />
        </p>
        <p>
          <label htmlFor="model-name">模型名</label>
          <input
            id="model-name"
            name="model_name"
            value={form.model_name}
            onChange={(event) => updateField("model_name", event.target.value)}
            placeholder="例如：gpt-4.1-mini"
            required
          />
        </p>
        <p>
          <label htmlFor="api-key">API Key</label>
          <input
            id="api-key"
            name="api_key"
            type="password"
            value={form.api_key}
            onChange={(event) => updateField("api_key", event.target.value)}
            autoComplete="off"
            required
          />
        </p>
        <button type="button" onClick={testConnection} disabled={isSubmitting}>
          测试连接
        </button>{" "}
        <button type="submit" disabled={isSubmitting}>
          保存并进入工作台
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
