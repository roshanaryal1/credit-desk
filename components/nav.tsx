"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/batches", label: "Invoice Check" },
  { href: "/watch", label: "Portfolio Watch" },
  { href: "/trust", label: "Trust Panel" },
  { href: "/audit", label: "Audit log" },
  { href: "/about", label: "About" },
];

export function Nav() {
  return <NavList pathname={usePathname()} />;
}

/** Links without an active marker; the static fallback for the nav. */
export function NavFallback() {
  return <NavList pathname={null} />;
}

function NavList({ pathname }: { pathname: string | null }) {
  const active = (href: string) =>
    pathname !== null &&
    (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav
      aria-label="Main"
      className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
    >
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active(item.href) ? "page" : undefined}
          className={cn(
            "text-muted-foreground rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
            "hover:bg-accent hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            active(item.href) && "bg-accent text-foreground font-medium",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
