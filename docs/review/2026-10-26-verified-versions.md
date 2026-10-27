# Verified dependency and runtime review

Issue #181. Registry and primary-source checks performed on 26 October 2026; key versions (next, eslint-config-next, typescript, the TypeScript 6 compatibility package, playwright, axe, npm, esbuild) re-checked with `npm view` on 27 October 2026. Versions below are the installed lockfile values, not inferred from version ranges.

| Package | Before | Current | Registry latest checked |
| --- | --- | --- | --- |
| `@axe-core/playwright` | None | 4.14.0 | 4.14.0 |
| `@base-ui/react` | 1.9.0 | 1.9.0 | 1.9.0 |
| `@electric-sql/pglite` | 0.5.11 | 0.5.11 | 0.5.11 |
| `@neondatabase/serverless` | 1.2.0 | 1.2.0 | 1.2.0 |
| `@tailwindcss/turbopack` | 4.3.3 | 4.3.3 | 4.3.3 |
| `@types/node` | 24.19.2 | 24.19.2 | 26.6.5 |
| `@types/react` | 19.3.0 | 19.3.0 | 19.3.0 |
| `@types/react-dom` | 19.3.0 | 19.3.0 | 19.3.0 |
| `@types/ws` | 8.18.2 | 8.18.2 | 8.18.2 |
| `@typescript/native` | new | 7.0.2 | 7.0.2 (typescript alias) |
| `@vitest/coverage-v8` | 5.0.5 | 5.0.5 | 5.0.5 |
| `class-variance-authority` | 0.7.1 | 0.7.1 | 0.7.1 |
| `cn` | 0.5.0 | 0.5.0 | 0.5.0 |
| `drizzle-kit` | 0.31.11 | 0.31.11 | 0.31.11 |
| `drizzle-orm` | 0.45.4 | 0.45.4 | 0.45.4 |
| `eslint` | 10.13.0 | 10.13.0 | 10.13.0 |
| `eslint-config-next` | 16.4.2 | 16.4.3 | 16.4.3 |
| `lucide-react` | 1.61.0 | 1.61.0 | 1.61.0 |
| `next` | 16.4.2 | 16.4.3 | 16.4.3 |
| `openai` | 7.43.0 | 7.43.0 | 7.43.0 |
| `playwright` | None | 1.64.1 | 1.64.1 |
| `prettier` | 3.9.10 | 3.9.10 | 3.9.10 |
| `prettier-plugin-tailwindcss` | 0.8.1 | 0.8.1 | 0.8.1 |
| `react` | 19.3.1 | 19.3.1 | 19.3.1 |
| `react-dom` | 19.3.1 | 19.3.1 | 19.3.1 |
| `recharts` | 3.10.1 | 3.10.1 | 3.10.1 |
| `server-only` | 0.0.1 | 0.0.1 | 0.0.1 |
| `shadcn` | 4.22.1 | 4.22.1 | 4.22.1 |
| `tailwindcss` | 4.3.3 | 4.3.3 | 4.3.3 |
| `tsx` | 4.23.15 | 4.23.15 | 4.23.15 |
| `tw-animate-css` | 1.4.0 | 1.4.0 | 1.4.0 |
| `typescript` | 5.9.3 | 6.0.2 | 7.0.2 native; 6.0.2 compatibility package |
| `vitest` | 5.0.5 | 5.0.5 | 5.0.5 |
| `ws` | 8.22.0 | 8.22.0 | 8.22.0 |
| `zod` | 4.6.7 | 4.6.7 | 4.6.7 |

## Runtime and toolchain

- Node 24.22.1 is the verified current 24 LTS patch. Vercel currently supports 24 and 22, so this project stays on 24 instead of the newer Current 26 line. Node type definitions follow 24. Vercel manages its installed patch; the build prints the actual runtime version.
- npm 12.2.1 is pinned for CI and Vercel install/build. npm 12 blocks dependency lifecycle scripts by default; this repository explicitly denies esbuild, fsevents and unrs-resolver scripts. Prebuilt optional binaries passed local installation and build checks. Linux CI and hosted installation must also pass.
- The native TypeScript 7.0.2 compiler is mandatory in prebuild. Microsoft's supported side-by-side aliases retain the JavaScript compiler API through `@typescript/typescript6@6.0.2` for ESLint and Next integrations. The compatibility package reports compiler API version 6.0.3. Type checking is not disabled.
- Playwright 1.64.1 and axe 4.14.0 are lockfile-pinned instead of installing an old independent browser runner in CI.
- Actions checkout 7.0.1, setup-node 7.1.0 and upload-artifact 7.0.2 use full verified release commit SHAs.

## Transitive constraints

`npm update` refreshed versions permitted by dependency ranges. `npm outdated --all --json` also reports vendor-constrained major versions, peer requirements and optional binaries for other platforms; it is not a list of safely interchangeable upgrades. Examples include Babel 7 in current tooling, esbuild 0.25.12 inside Drizzle Kit and PostCSS 8.5.23 bundled with Next. The obsolete esbuild override in core-utils is updated to 0.28.2 and Drizzle generation proves no schema drift.

Current upstream ESLint plugins still advertise peer ranges ending at 9 while the project uses latest ESLint 10.13.0. Installation reports the peer warnings; lint passes. No force or legacy-peer-deps bypass is configured. Arbitrarily replacing vendor internals or switching the runtime type API to 26 would require separate compatibility evidence.

## Verification and sources

Local Node 24 and npm 12 checks on 26 October 2026: 447 tests, typecheck, lint (7 existing warnings), formatting, standard production build, client bundle scan, synthetic evaluation and audit with 0 known vulnerabilities; `npm run db:generate` reported no schema changes. After rebasing onto `41bf8b1` on 27 October 2026 the same gates passed (474 tests, audit 0 vulnerabilities) on a workstation with Node 26.10.0 and npm 11.19.1, which reports an engine warning only. CI and Vercel run the pinned Node 24 and npm 12 toolchain; browser matrix and hosted install are separate acceptance steps.

Reproduce registry checks with `npm view <package> version engines peerDependencies license --json`, `npm outdated --all --json` and `npm audit --json`. The lockfile records resolved artifacts and integrity hashes.

- [Microsoft TypeScript 7 side-by-side guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Vercel supported Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Node downloads](https://nodejs.org/en/download)
- [npm 12 lifecycle policy](https://docs.npmjs.com/cli/v12/commands/npm-install/)
- [Vercel project configuration](https://vercel.com/docs/project-configuration)
