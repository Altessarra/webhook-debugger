import type { ReactNode } from "react";
import { AppRail } from "./AppRail";
import type { Theme } from "../types/theme";

export function AppShell({
  children,
  theme,
  onToggleTheme,
}: {
  children: ReactNode;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  return (
    <main className="app-shell">
      <AppRail theme={theme} onToggleTheme={onToggleTheme} />
      <div className="app-shell-content">{children}</div>
    </main>
  );
}
