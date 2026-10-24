"use client";

import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => obs.disconnect();
};

export function ThemeToggle() {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Storage can be unavailable; the toggle still works for this page.
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring rounded-md px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
    >
      {dark ? "Light theme" : "Dark theme"}
    </button>
  );
}

/** Inline script that applies the saved or system theme before first paint. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
