import type { PropsWithChildren } from "react";

import { TopBar } from "../../components/shell/TopBar";
import { SideNav } from "../../components/shell/SideNav";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-shell__body">
        <SideNav />
        <main className="content-frame">
          <div className="page-wrap">{children}</div>
        </main>
      </div>
    </div>
  );
}
