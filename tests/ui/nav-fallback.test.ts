import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { Nav, NavFallback } from "@/components/nav";
import { DEMO_PERSONA_KEYS, demoRouteAllowed } from "@/lib/demo-personas";

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!);

describe("navigation links match what each viewer may open (#203)", () => {
  it("prerendered fallback names no persona-specific route", () => {
    expect(hrefs(renderToStaticMarkup(createElement(NavFallback)))).toEqual([
      "/about",
    ]);
  });

  it("signed-out navigation shows only public links", () => {
    expect(
      hrefs(renderToStaticMarkup(createElement(Nav, { persona: null }))),
    ).toEqual(["/about"]);
  });

  it.each(DEMO_PERSONA_KEYS)("%s sees only routes it can open", (persona) => {
    const links = hrefs(renderToStaticMarkup(createElement(Nav, { persona })));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links)
      expect(demoRouteAllowed(persona, href)).toBe(true);
  });

  it("keeps server-scoped client links in verified-identity navigation", () => {
    const html = renderToStaticMarkup(
      createElement(Nav, {
        persona: null,
        allowed: ["/about"],
        extra: [
          {
            heading: "Your clients",
            items: [{ href: "/clients/cli_a", label: "Client A" }],
          },
        ],
      }),
    );
    expect(hrefs(html)).toEqual(["/clients/cli_a", "/about"]);
  });
});
