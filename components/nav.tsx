"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { demoRouteAllowed, type DemoPersona } from "@/lib/demo-personas";

const GROUPS = [
  {
    heading: "Work",
    items: [
      { href: "/", label: "Overview" },
      { href: "/queue", label: "Review Queue" },
      { href: "/batches", label: "Invoice Check" },
      { href: "/watch", label: "Portfolio Watch" },
      { href: "/clients", label: "Clients" },
      { href: "/borrowing-base", label: "Borrowing base" },
    ],
  },
  {
    heading: "Assurance",
    items: [
      { href: "/trust", label: "Trust Panel" },
      { href: "/credit-memos", label: "Credit memos" },
      { href: "/audit", label: "Audit log" },
      { href: "/about", label: "About" },
    ],
  },
] as const;

export function Nav({ persona }: { persona: DemoPersona }) {
  return <NavList pathname={usePathname()} persona={persona} />;
}

/** Static navigation fallback while the browser pathname is loading. */
export function NavFallback() {
  return <NavList pathname={null} persona="ANALYST" />;
}

function NavList({ pathname, persona }: { pathname: string | null; persona: DemoPersona }) {
  const active = (href: string) =>
    pathname !== null &&
    (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const groups = persona === "CLIENT"
    ? [{ heading: "Borrower demo", items: [{ href: "/demo/client", label: "My fictional facility" }, { href: "/about", label: "About" }] }]
    : GROUPS.map((group) => ({
        heading: group.heading,
        items: group.items.filter((item) => demoRouteAllowed(persona, item.href)),
      })).filter((group) => group.items.length > 0);

  return (
    <nav
      aria-label="Main"
      className="flex gap-3 overflow-x-auto md:flex-col md:gap-6 md:overflow-visible"
    >
      {groups.map((group) => ( 
        <div
          key={group.heading}
          className="flex gap-1 md:flex-col"
          aria-label={group.heading}
        >
          <p className="text-muted-foreground hidden px-3 pb-1 text-[10px] font-semibold tracking-[0.16em] uppercase md:block">
            {group.heading}
          </p>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? "page" : undefined}
              className={cn(
                "text-muted-foreground rounded-sm border-l-2 border-transparent px-3 py-2 text-sm whitespace-nowrap transition-colors",
                "hover:bg-accent hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                active(item.href) &&
                  "border-primary bg-accent/60 text-foreground font-semibold",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
