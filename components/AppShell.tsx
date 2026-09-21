import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppShell({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-5">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium tracking-[0.2em]">ASTRONOTES</span>
        </div>
        <div className="flex items-center gap-4">
          {trailing}
          <ThemeToggle />
        </div>
      </header>
      {children}
    </div>
  );
}
