import { ReactNode } from "react";

export type WorkspacePage = "overview" | "materials" | "audit" | "report" | "interview";

type WorkbenchShellProps = {
  activePage: WorkspacePage;
  children: ReactNode;
  lockedPages?: Partial<Record<WorkspacePage, string>>;
  onNavigate: (page: WorkspacePage) => void;
  taskControls?: ReactNode;
};

const navigation: { id: WorkspacePage; label: string }[] = [
  { id: "overview", label: "任务概览" },
  { id: "materials", label: "材料中心" },
  { id: "audit", label: "证据审计" },
  { id: "report", label: "审计报告" },
  { id: "interview", label: "模拟面试" },
];

export function WorkbenchShell({ activePage, children, lockedPages = {}, onNavigate, taskControls }: WorkbenchShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>求职证据审计</strong>
          <span>本地可追溯工作台</span>
        </div>
        {taskControls}
        <nav aria-label="任务导航">
          {navigation.map((item) => {
            const lockedReason = lockedPages[item.id];
            const isActive = activePage === item.id;
            return (
              <div className="nav-item" key={item.id}>
                <button
                  aria-current={isActive ? "page" : undefined}
                  aria-disabled={lockedReason ? "true" : undefined}
                  className={isActive ? "nav-button active" : "nav-button"}
                  disabled={Boolean(lockedReason)}
                  onClick={() => onNavigate(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
                {lockedReason ? <small>{lockedReason}</small> : null}
              </div>
            );
          })}
        </nav>
        <button className="settings-button" type="button">设置</button>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}
