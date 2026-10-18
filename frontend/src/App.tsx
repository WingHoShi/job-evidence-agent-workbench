import { useEffect, useState } from "react";

import { ModelConfigStatus, SetupPage } from "./features/setup/SetupPage";
import { TaskWorkspace } from "./features/workbench/TaskWorkspace";

const unconfigured: ModelConfigStatus = {
  configured: false,
  base_url: null,
  model_name: null,
};

export default function App() {
  const [status, setStatus] = useState<ModelConfigStatus>(unconfigured);

  useEffect(() => {
    void fetch("/api/setup/status")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("无法读取配置状态");
        }
        return (await response.json()) as ModelConfigStatus;
      })
      .then(setStatus)
      .catch(() => setStatus(unconfigured));
  }, []);

  if (!status.configured) {
    return <SetupPage onConfigured={setStatus} />;
  }

  return <TaskWorkspace />;
}
