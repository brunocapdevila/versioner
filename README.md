# Versioner

A TypeScript workspace for schema versions and explicit data migrations. Native ESM, bundled declarations, no framework or mandatory schema-validator dependency.

Two packages live in this repository:

| Package (temporary name)     | Purpose                                                                        | Runtime dependencies |
| ---------------------------- | ------------------------------------------------------------------------------ | -------------------- |
| `@versioner-local/versions`  | SemVer parsing, exact shorthand, comparison, increments, npm-style ranges      | None                 |
| `@versioner-local/versioner` | Typed migration builder, path planning, optional validation, resource adapters | `versions`           |

Names are placeholders. Both packages are private and unpublished. Choose an npm scope and finalize the public API before publishing. The project uses the MIT license and lives at https://github.com/brunocapdevila/versioner.

## Development

Install [Vite+](https://viteplus.dev/guide/). The toolchain is pinned to Vite+ 1.3.0 and npm 11.19.1. Use Node 22.18+ or 24.11+ for the development tools. Run all project commands through `vp`; it delegates dependency management to the pinned npm version.

```sh
vp install
vp run verify
vp test run --coverage
```

`vp run verify` builds packages in dependency order, runs Vite+ static checks and TypeScript contract checks, runs unit tests, and verifies Node ESM imports and browser-target bundles. Use `vp check` for formatting, linting, and type checks; `vp fmt` formats sources. Libraries build with `vp pack`, orchestrated by `vp run build`. Runtime code targets ES2022 and uses `structuredClone` by default; provide a custom clone strategy for other environments or data types.

## The envelope

```ts
import type { Versioned } from '@versioner-local/versioner';

type DocumentV1 = { name: string };
const document: Versioned<'1', DocumentV1> = {
  version: '1',
  data: { name: 'Bruno' },
};
```

The version describes the **data schema**, separately from package releases and record revisions. `data` can be a primitive or an object. Numeric shorthand is supported by the version utilities; envelope versions and migration endpoints are strings, preserving literal inference.

## Exact versions and ranges

```ts
import { parse, normalizeVersion, compare, increment, satisfies } from '@versioner-local/versions';

parse('1.2.3-beta.1+build'); // strict SemVer, immutable parsed components
normalizeVersion(1); // '1.0.0'
normalizeVersion('1'); // '1.0.0'
normalizeVersion('1.2'); // '1.2.0'
compare('1', '1.0.0'); // 0
increment('1', 'major'); // '2.0.0'
satisfies('1.5.0', '1'); // true: range '1' means 1.x
satisfies('1.5.0', '=1.0.0'); // false
```

Exact shorthand expands missing components to zero. Range strings retain npm semantics: a bare `1` or `=1` is a major range. Use `=1.0.0` for exact range matching. Range matching excludes prereleases unless explicitly included by a comparator on the same version tuple, or enabled with `{ includePrerelease: true }`.

`parse` rejects shorthand, `v` prefixes, whitespace, leading zeroes, and unsafe numeric components. Numeric prerelease identifiers remain strings so large identifiers compare precisely. Build metadata is retained in formatting and ignored for precedence. Invalid exact versions throw; `satisfies` returns false for invalid versions or ranges.

`increment` supports `major`, `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease`, and `release`, with an optional prerelease identifier. `previousVersion` and `nextVersion` select from known versions rather than inventing predecessors.

This is an initial implementation of npm-style range behavior, not a promise of complete node-semver API parity. Loose parsing, coercion, CLI/classes, identifier-base options, range intersections and simplification are outside the initial API.

## Migration-local types

```ts
import { createVersioning } from '@versioner-local/versioner';

type V1 = { name: string };
type V2 = { displayName: string };

const users = createVersioning()
  .addMigration({
    from: '1',
    to: '2',
    transform: (user: V1): V2 => ({ displayName: user.name }),
  })
  .addMigration({
    from: '2',
    to: '3',
    // Known input types are inferred from earlier registrations.
    transform: (user) => ({ ...user, active: true }),
  })
  .build();

users.plan('1', '3');
// [{ from: '1.0.0', to: '2.0.0' }, { from: '2.0.0', to: '3.0.0' }]

const result = await users.migrate({ version: '1', data: { name: 'Bruno' } }, '3');
// { version: '3', data: { displayName: 'Bruno', active: true } }
```

No central map or full historical schemas are required. The builder accumulates schema types and rejects conflicting types for a known version. Plain object types work best: this is a structural TypeScript contract, not runtime proof. Historical definitions are needed only for supported migration boundaries.

Migration identity normalizes shorthand and ignores build metadata: `1`, `1.0.0`, and `1.0.0+build` denote the same schema node. Plans use normalized identities. Results preserve the requested target spelling, so `migrate(input, '3')` returns version `'3'`.

The builder is immutable: keep chaining or assign the returned builder. A built instance is unaffected by later builder branches.

## Validation is optional

```ts
const checked = createVersioning()
  .addMigration({
    from: '1',
    to: '2',
    transform: (user: V1): V2 => ({ displayName: user.name }),
  })
  .addVersion('1', {
    validate: (value) =>
      typeof value === 'object' &&
      value !== null &&
      'name' in value &&
      typeof value.name === 'string',
  })
  .addVersion('2', {
    validate: (value) =>
      typeof value === 'object' &&
      value !== null &&
      'displayName' in value &&
      typeof value.displayName === 'string',
  })
  .build();
```

Register validators for every version, selected boundaries, or none. Validators receive `unknown`, may be async, and accept by returning true/void; false or a thrown error rejects the value. This accommodates Zod, Valibot, JSON Schema, and ordinary functions without importing them into the core. Validator registration does not assert a TypeScript schema type.

Use `migrateUnknown` for parsed/persisted input. Validators run on the source and after each step where registered, including same-version calls. Without validators, shape correctness depends on the caller and migrations. Static types disappear at runtime.

## Path and execution rules

- Endpoints are exact versions; range matching never substitutes for a transformation.
- Paths move monotonically from source to target and stay within that interval.
- A single valid path is required. Missing paths and ambiguous alternatives throw. Adding a direct shortcut alongside a chain is ambiguous; replace the chain in that registry or use a separate registry.
- Downgrades require explicitly registered reverse transformations; data loss is never reversed automatically.
- Execution awaits transformations sequentially and returns a new envelope only after success.
- The input is cloned once before validators or transformations run. Nested mutations operate on this copy, protecting the caller on both success and failure.
- `structuredClone` does not preserve arbitrary class behavior and cannot clone functions. Provide `{ clone }` when creating the builder for special values. A custom clone must return an independent copy.
- Migrators and validators should avoid external side effects. Input isolation does not roll back network/database writes or mutations of captured external objects.

`MigrationError` exposes `code`, the relevant `step`, and the original `cause` when available. Codes distinguish unknown versions, absent/ambiguous paths, invalid registration, validation failures, transformation failures, and clone failures.

## Existing resource formats

```ts
import { migrateResource } from '@versioner-local/versioner';

const resource: { id: string; schemaVersion: string; payload: unknown } = {
  id: 'abc',
  schemaVersion: '1',
  payload: { name: 'Bruno' },
};

const updated = await migrateResource(users, resource, '3', {
  read: (r) => ({ version: r.schemaVersion, data: r.payload }),
  write: (r, value) => ({ ...r, schemaVersion: value.version, payload: value.data }),
});
```

The helper clones the resource before invoking the adapter, then uses the normal migration engine. Adapter functions should be pure. Storage, persistence, and transactions belong to the caller.

## Compatibility baseline

Fixtures are adapted from node-semver **v7.8.5**, commit `6e05b7637396ac66522cff8731f07cfe0ef49a29`. Tests exercise applicable strict inputs for parsing, comparison, equality, increments, and range inclusion/exclusion. Unsupported loose parsing, non-strict exact prefixes, and identifier-base API cases are explicitly excluded. Generated comparisons also check range behavior against the pinned node-semver development dependency.

Tests cover migration chains, downgrades, ambiguity, long chains, optional validators, async failures, input preservation, adapters, type inference, and compile-time rejection of incompatible schemas. See `THIRD_PARTY_NOTICES.md` for the upstream ISC notice. The runtime implementation does not import node-semver.
