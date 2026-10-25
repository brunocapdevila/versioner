# Repository instructions

Use Vite+ (`vp`) for this repository's toolchain. The two libraries share one npm workspace; keep their runtime code framework-independent and free of Node-only APIs.

- Install dependencies with `vp install` (npm is pinned in package.json).
- Build both packages in dependency order with `vp run build`; library configs use `vp pack`.
- Use `vp check` for formatting, linting, and type checks, and `vp fmt` to format.
- Run `vp test run` or `vp test run --coverage` for tests.
- Run `vp run verify` for the full build, static checks, type-contract tests, unit tests, and Node/browser ESM smoke checks.
- Keep node-semver as a development-only compatibility baseline. Preserve its notice when changing copied fixtures.
- Package names are provisional and packages remain private until publication is explicitly requested.
