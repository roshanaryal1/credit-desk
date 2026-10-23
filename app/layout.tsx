import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";

import { Suspense } from "react";

import { Nav, NavFallback } from "@/components/nav";
import { SignOut } from "@/components/sign-out";
import { THEME_SCRIPT, ThemeToggle } from "@/components/theme-toggle";

import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Credit Desk", template: "%s | Credit Desk" },
  description: "Prototype credit operations desk. All data is synthetic.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-NZ"
      className={`${publicSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="focus:bg-background sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <div
          role="note"
          className="bg-status-flagged-bg text-status-flagged border-b px-4 py-1.5 text-center text-xs"
        >
          Prototype for discussion. All data is synthetic.
        </div>
        <div className="flex flex-1 flex-col md:flex-row">
          <aside className="flex flex-col gap-4 border-b px-3 py-3 md:w-56 md:shrink-0 md:border-r md:border-b-0 md:px-4 md:py-6">
            <div className="px-3">
              <p className="font-semibold tracking-tight">Credit Desk</p>
              <p className="text-muted-foreground text-xs">
                Invoice finance operations
              </p>
            </div>
            <Suspense fallback={<NavFallback />}>
              <Nav />
            </Suspense>
            <div className="flex flex-wrap items-center md:hidden">
              <ThemeToggle />
              <Suspense>
                <SignOut />
              </Suspense>
            </div>
            <div className="hidden md:mt-auto md:flex md:flex-col">
              <ThemeToggle />
              <Suspense>
                <SignOut />
              </Suspense>
            </div>
          </aside>
          <main id="main" className="flex-1 px-4 py-6 md:px-8 md:py-8">
            <div className="mx-auto flex max-w-6xl flex-col gap-8">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
