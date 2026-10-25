import { compare, normalizeVersion } from '@versioner-local/versions';

export type Versioned<V extends string, T> = { version: V; data: T };
export type Validator = (value: unknown) => boolean | void | Promise<boolean | void>;
export interface VersionAdapter<Resource, V extends string, T> {
  read(resource: Resource): Versioned<V, T>;
  write(resource: Resource, value: Versioned<V, T>): Resource;
}
export interface Migration<F extends string, T extends string, Input, Output> {
  readonly from: F;
  readonly to: T;
  readonly transform: (data: Input) => Output | Promise<Output>;
}
export interface VersionOptions {
  readonly validate?: Validator;
}
export interface BuilderOptions {
  /** Must return an independent copy; defaults to structuredClone. */
  readonly clone?: (data: unknown) => unknown;
}
export interface MigrationStep {
  readonly from: string;
  readonly to: string;
}
export type ErrorCode =
  | 'INVALID_VERSION'
  | 'DUPLICATE_MIGRATION'
  | 'DUPLICATE_VALIDATOR'
  | 'UNKNOWN_VERSION'
  | 'NO_PATH'
  | 'AMBIGUOUS_PATH'
  | 'VALIDATION_FAILED'
  | 'TRANSFORM_FAILED'
  | 'CLONE_FAILED';
export class MigrationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly step?: MigrationStep,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MigrationError';
  }
}
type StripBuild<V extends string> = V extends `${infer Base}+${string}` ? Base : V;
type Canonical<V extends string> =
  StripBuild<V> extends infer S extends string
    ? S extends `${string}.${string}.${string}`
      ? S
      : S extends `${string}.${string}`
        ? `${S}.0`
        : `${S}.0.0`
    : never;
type Lookup<M, V extends string> = Canonical<V> extends keyof M ? M[Canonical<V>] : never;
type Known<M, V extends string> = Canonical<V> extends keyof M ? unknown : never;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Check<M, V extends string, Value> =
  Canonical<V> extends keyof M
    ? unknown extends M[Canonical<V>]
      ? unknown
      : Equal<M[Canonical<V>], Value> extends true
        ? unknown
        : { readonly incompatibleVersionType: V }
    : unknown;
type Add<M, F extends string, T extends string, I, O> = M &
  Record<Canonical<F>, I> &
  Record<Canonical<T>, O>;
interface Edge extends MigrationStep {
  transform: (data: unknown) => unknown;
}
interface State {
  edges: readonly Edge[];
  validators: ReadonlyMap<string, Validator>;
  versions: ReadonlySet<string>;
}
function key(version: string): string {
  try {
    return normalizeVersion(version).split('+')[0]!;
  } catch (cause) {
    throw new MigrationError('INVALID_VERSION', `Invalid version: ${version}`, undefined, {
      cause,
    });
  }
}
function addVersion(state: State, ...versions: string[]): ReadonlySet<string> {
  return new Set([...state.versions, ...versions]);
}

export class VersioningBuilder<M = {}> {
  /** @internal Prefer createVersioning(). */
  constructor(
    private readonly state: State = { edges: [], validators: new Map(), versions: new Set() },
    private readonly options: BuilderOptions = {},
  ) {}
  addVersion<const V extends string>(
    version: V,
    options: VersionOptions = {},
  ): VersioningBuilder<M & Record<Canonical<V>, unknown>> {
    const v = key(version),
      validators = new Map(this.state.validators);
    if (options.validate) {
      if (validators.has(v))
        throw new MigrationError('DUPLICATE_VALIDATOR', `Validator already registered for ${v}`);
      validators.set(v, options.validate);
    }
    return new VersioningBuilder(
      { ...this.state, validators, versions: addVersion(this.state, v) },
      this.options,
    );
  }
  addMigration<const F extends string, const T extends string, I = Lookup<M, F>, O = unknown>(
    migration: Migration<F, T, I, O> &
      Check<M, F, I> &
      Check<M, T, O> &
      (string extends F | T
        ? unknown
        : Canonical<F> extends Canonical<T>
          ? { readonly identicalEndpoints: never }
          : unknown),
  ): VersioningBuilder<Add<M, F, T, I, O>> {
    const from = key(migration.from),
      to = key(migration.to);
    if (from === to)
      throw new MigrationError(
        'DUPLICATE_MIGRATION',
        `Migration endpoints are equivalent: ${from}`,
      );
    if (this.state.edges.some((e) => e.from === from && e.to === to))
      throw new MigrationError(
        'DUPLICATE_MIGRATION',
        `Migration already registered: ${from} -> ${to}`,
      );
    const edge: Edge = { from, to, transform: migration.transform as Edge['transform'] };
    return new VersioningBuilder(
      {
        ...this.state,
        edges: [...this.state.edges, edge],
        versions: addVersion(this.state, from, to),
      },
      this.options,
    );
  }
  build(): Versioning<M> {
    return new Versioning(this.state, this.options);
  }
}

export class Versioning<M> {
  /** @internal Use builder.build(). */
  constructor(
    private readonly state: State,
    private readonly options: BuilderOptions,
  ) {}
  private resolve(fromInput: string, toInput: string): readonly Edge[] {
    const from = key(fromInput),
      to = key(toInput);
    for (const v of [from, to])
      if (!this.state.versions.has(v))
        throw new MigrationError('UNKNOWN_VERSION', `Unknown version: ${v}`);
    if (from === to) return [];
    const direction = compare(to, from);
    const nodes = [...this.state.versions]
      .filter((v) => {
        const start = compare(v, from),
          end = compare(to, v);
        return (start === 0 || start === direction) && (end === 0 || end === direction);
      })
      .sort((a, b) => compare(a, b) * direction);
    const outgoing = new Map<string, Edge[]>();
    for (const edge of this.state.edges) {
      if (compare(edge.to, edge.from) !== direction) continue;
      const list = outgoing.get(edge.from) ?? [];
      list.push(edge);
      outgoing.set(edge.from, list);
    }
    const eligible = new Set(nodes),
      counts = new Map<string, number>([[from, 1]]),
      parents = new Map<string, Edge>();
    // A monotonic graph is a DAG: count paths, capped at two, in version order.
    // This avoids recursion and exponential traversal through dead ends.
    for (const node of nodes) {
      const count = counts.get(node) ?? 0;
      if (!count) continue;
      for (const edge of outgoing.get(node) ?? []) {
        if (!eligible.has(edge.to)) continue;
        const prior = counts.get(edge.to) ?? 0;
        counts.set(edge.to, Math.min(2, prior + count));
        if (!prior) parents.set(edge.to, edge);
      }
    }
    const count = counts.get(to) ?? 0;
    if (!count) throw new MigrationError('NO_PATH', `No migration path: ${from} -> ${to}`);
    if (count > 1)
      throw new MigrationError('AMBIGUOUS_PATH', `Multiple migration paths: ${from} -> ${to}`);
    const path: Edge[] = [];
    for (let node = to; node !== from;) {
      const edge = parents.get(node)!;
      path.push(edge);
      node = edge.from;
    }
    return path.reverse();
  }
  plan(from: string, to: string): readonly MigrationStep[] {
    return Object.freeze(this.resolve(from, to).map(({ from, to }) => Object.freeze({ from, to })));
  }
  migrate<const F extends string, const T extends string>(
    input: Versioned<F, Lookup<M, F>>,
    to: T & Known<M, T>,
  ): Promise<Versioned<T, Lookup<M, T>>> {
    return this.migrateUnknown(input, to);
  }
  /** For persisted/external values. Register validators to check runtime shapes. */
  async migrateUnknown<const T extends string>(
    input: Versioned<string, unknown>,
    to: T & Known<M, T>,
  ): Promise<Versioned<T, Lookup<M, T>>> {
    const path = this.resolve(input.version, to);
    let data: unknown;
    try {
      data = (this.options.clone ?? structuredClone)(input.data);
    } catch (cause) {
      throw new MigrationError('CLONE_FAILED', 'Could not clone migration input', undefined, {
        cause,
      });
    }
    const validate = async (version: string, step?: MigrationStep) => {
      const validator = this.state.validators.get(version);
      if (!validator) return;
      try {
        if ((await validator(data)) === false) throw new TypeError(`Validator rejected ${version}`);
      } catch (cause) {
        throw new MigrationError('VALIDATION_FAILED', `Validation failed for ${version}`, step, {
          cause,
        });
      }
    };
    await validate(key(input.version), path[0]);
    for (const edge of path) {
      const step = Object.freeze({ from: edge.from, to: edge.to });
      try {
        data = await edge.transform(data);
      } catch (cause) {
        throw new MigrationError(
          'TRANSFORM_FAILED',
          `Migration failed: ${edge.from} -> ${edge.to}`,
          step,
          { cause },
        );
      }
      await validate(edge.to, step);
    }
    // Preserve the caller's target spelling; plan uses normalized identities.
    return { version: to, data: data as Lookup<M, T> };
  }
}
export function createVersioning(options: BuilderOptions = {}): VersioningBuilder {
  return new VersioningBuilder(undefined, { ...options });
}

/** Adapter functions should be pure. The original resource is cloned before write. */
export async function migrateResource<M, R, V extends string, D, const T extends string>(
  engine: Versioning<M>,
  resource: R,
  to: T & Known<M, T>,
  adapter: {
    read(resource: R): Versioned<V, D>;
    write(resource: R, value: Versioned<T, Lookup<M, T>>): R;
  },
  clone: (resource: R) => R = structuredClone,
): Promise<R> {
  const copy = clone(resource);
  const result = await engine.migrateUnknown(adapter.read(copy), to);
  return adapter.write(copy, result);
}
