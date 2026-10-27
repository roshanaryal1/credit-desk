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
      { href: "/operations/sources", label: "Ingestion health" },
      { href: "/about", label: "About" },
    ],
  },
] as const;

export interface NavGroup {
  heading: string;
  items: { href: string; label: string }[];
}

export function Nav({
  persona,
  allowed,
  extra = [],
}: {
  persona: DemoPersona | null;
  /** Verified-identity mode: the exact routes this user may open. */
  allowed?: string[];
  /** Verified-identity mode: per-user links, such as granted clients. */
  extra?: NavGroup[];
}) {
  return (
    <NavList
      pathname={usePathname()}
      persona={persona}
      allowed={allowed}
      extra={extra}
    />
  );
}

/**
 * Static fallback while the session streams in. It names no persona, so the
 * prerendered shell never shows (or prefetches) links a persona cannot open.
 */
export function NavFallback() {
  return <NavList pathname={null} persona={null} />;
}

function NavList({
  pathname,
  persona,
  allowed,
  extra = [],
}: {
  pathname: string | null;
  persona: DemoPersona | null;
  allowed?: string[];
  extra?: NavGroup[];
}) {
  const active = (href: string) =>
    pathname !== null &&
    (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const groups = allowed
    ? [
        // Extra groups are already scoped on the server (granted clients).
        ...extra,
        ...[
          ...GROUPS,
          {
            heading: "Administration",
            items: [{ href: "/admin/users", label: "Users and access" }],
          },
        ]
          .map((group) => ({
            heading: group.heading,
            items: group.items.filter((item) => allowed.includes(item.href)),
          }))
          .filter((group) => group.items.length > 0),
      ]
    : persona === null
      ? [
          {
            heading: "Credit Desk",
            items: [{ href: "/about", label: "About" }],
          },
        ]
      : persona === "CLIENT"
        ? [
            {
              heading: "Borrower demo",
              items: [
                { href: "/demo/client", label: "My fictional facility" },
                { href: "/about", label: "About" },
              ],
            },
          ]
        : GROUPS.map((group) => ({
            heading: group.heading,
            items: group.items.filter((item) =>
              demoRouteAllowed(persona, item.href),
            ),
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
              onFocus={(event) => {
                event.currentTarget.scrollIntoView({
                  block: "nearest",
                  inline: "nearest",
                });
              }}
              className={cn(
                "text-muted-foreground scroll-mx-1 rounded-sm border-l-2 border-transparent px-3 py-2 text-sm whitespace-nowrap transition-colors",
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
