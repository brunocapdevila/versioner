# versions

Native TypeScript, ESM version utilities with strict SemVer parsing, explicit exact-version shorthand, comparison, increments, and npm-style range matching. Zero runtime dependencies.

Temporary package name: `@versioner-local/versions`. Private and unpublished.

```ts
import { normalizeVersion, compare, satisfies } from '@versioner-local/versions';
normalizeVersion('1'); // '1.0.0'
compare('1', '1.0.0'); // 0
satisfies('1.5.0', '1'); // true: range '1' means 1.x
```

See the repository README for the API, compatibility scope, and test baseline.
