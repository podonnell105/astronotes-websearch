import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import Link from "next/link";

export function AppShell({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2 md:px-5">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-[13px] font-medium tracking-[0.2em]">
            ASTRONOTES
          </Link>
        </div>
        <div className="flex min-w-0 flex-nowrap items-center justify-end gap-3">
          {trailing}
          <ThemeToggle />
        </div>
      </header>
      {children}
    </div>
  );
}
