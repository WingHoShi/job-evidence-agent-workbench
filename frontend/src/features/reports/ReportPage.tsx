import { ReportWorkspacePage } from "./ReportWorkspacePage";

export function ReportPage({ taskId, onGenerated }: { taskId: number; onGenerated?: () => void }) {
  // 旧入口复用同一份报告展示；是否允许生成仍由后端校验。
  return <ReportWorkspacePage taskId={taskId} auditStatus="completed" onGenerated={onGenerated ?? (() => {})} />;
}
