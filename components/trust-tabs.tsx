import Link from "next/link";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/trust", label: "Agreement" },
  { href: "/trust/evaluation", label: "Evaluation" },
  { href: "/trust/replay", label: "Replay" },
];

export function TrustTabs({ current }: { current: string }) {
  return (
    <nav aria-label="Trust Panel" className="flex gap-1 border-b">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={current === t.href ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring -mb-px border-b-2 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none",
            current === t.href
              ? "border-primary font-medium"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
