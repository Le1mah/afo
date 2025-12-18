# Repository Guidelines

## Project Structure & Module Organization
The repository is intentionally bootstrapped and should grow around four roots: `src/` for application modules (group features under `src/core`, `src/features/<feature>`, and `src/lib`), `tests/` for executable specs mirroring the module paths, `public/` for static assets, and `docs/` for ADRs and diagrams. Keep environment helpers or data-migration utilities in `scripts/` so they stay out of production bundles, and add a short `README.md` to any new top-level domain.

## Build, Test, and Development Commands
Run `npm install` once per clone to restore toolchain dependencies. Use `npm run dev` for the hot-reload development server; it watches `src/` and regenerates artifacts in memory. Execute `npm run build` before publishing to verify the optimized bundle. `npm test` runs the unit and integration suites in `tests/`. Add `npm run lint` and `npm run format` to your pre-commit workflow so TypeScript, ESLint, and Prettier stay aligned with CI expectations.

## Coding Style & Naming Conventions
Prefer TypeScript (`.ts/.tsx`) and keep modules under 300 lines; split shared utilities into `src/lib`. Use two-space indentation, trailing commas, and single quotes—`npm run format` enforces the Prettier profile. Follow ESLint’s import ordering: node modules, third-party libraries, internal aliases. Name React components with `PascalCase`, hooks with `use` prefixes, and files that export a single element after that element (for example, `src/features/auth/AuthPanel.tsx`). Keep environment variable names upper snake case (`AFO_API_URL`) and document each variable inside `docs/config.md`.

## Testing Guidelines
Vitest runs all specs; colocate fast, pure unit tests under `tests/unit/<module>.test.ts` and slower integration flows under `tests/integration/<feature>.test.ts`. Mock network calls with MSW stubs in `tests/mocks/`. Every feature PR should add or update at least one test covering the change surface and keep branch coverage above 80%; check the summary emitted by `npm test -- --coverage`. When fixing a regression, add the matching test and mention its file path in the issue.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat: add auth session timeout`, `fix: guard null profile`). Keep commits focused; squash only when the intermediate history lacks value. Pull requests must describe scope, testing evidence (paste the relevant command output), UI screenshots when applicable, and any follow-up tasks. Link GitHub issues or Linear tickets in the PR body (`Closes #12`) so automation can track delivery. Request at least one review, wait for CI to pass, then use the “Rebase and merge” strategy to maintain a linear history.
