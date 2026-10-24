import { describe, expect, expectTypeOf, it } from 'vitest';
import { createVersioning, migrateResource, MigrationError } from '../src/index.js';
import type { Versioned } from '../src/index.js';

type V1 = { name: string; nested: { tags: string[] } };
type V2 = { displayName: string; nested: { tags: string[] } };
type V3 = V2 & { active: boolean };
const first = {
  from: '1',
  to: '2',
  transform: (v: V1): V2 => ({ displayName: v.name, nested: v.nested }),
} as const;
const second = { from: '2', to: '3', transform: (v: V2): V3 => ({ ...v, active: true }) } as const;
const builder = () => createVersioning().addMigration(first).addMigration(second);
const source = (): Versioned<'1', V1> => ({
  version: '1',
  data: { name: 'Bruno', nested: { tags: ['a'] } },
});

describe('migration execution', () => {
  it('resolves a multistep chain with shorthand identities', async () => {
    const engine = builder().build();
    expect(engine.plan('1.0.0', '3')).toEqual([
      { from: '1.0.0', to: '2.0.0' },
      { from: '2.0.0', to: '3.0.0' },
    ]);
    const input = source(),
      result = await engine.migrate(input, '3');
    expectTypeOf(result).toEqualTypeOf<Versioned<'3', V3>>();
    expect(result).toEqual({
      version: '3',
      data: { displayName: 'Bruno', nested: { tags: ['a'] }, active: true },
    });
    expect(result.data.nested).not.toBe(input.data.nested);
    expect(input).toEqual(source());
  });
  it('infers target type through exact aliases', async () => {
    const output = await builder()
      .build()
      .migrate({ version: '1.0.0', data: source().data }, '3.0.0');
    expectTypeOf(output).toEqualTypeOf<Versioned<'3.0.0', V3>>();
  });
  it('supports primitives and async transformations', async () => {
    const engine = createVersioning()
      .addMigration({ from: '1', to: '2', transform: async (n: number) => String(n) })
      .build();
    expect(await engine.migrate({ version: '1', data: 42 }, '2')).toEqual({
      version: '2',
      data: '42',
    });
  });
  it('clones no-op migrations too', async () => {
    const input = source(),
      engine = builder().build();
    const output = await engine.migrate(input, '1');
    expect(output).toEqual(input);
    expect(output.data).not.toBe(input.data);
    expect(engine.plan('1', '1.0.0')).toEqual([]);
  });
  it('protects nested input against a mutating transform', async () => {
    const engine = createVersioning()
      .addMigration({
        ...first,
        transform: (v: V1): V2 => {
          v.nested.tags.push('b');
          return { displayName: v.name, nested: v.nested };
        },
      })
      .build();
    const input = source();
    await engine.migrate(input, '2');
    expect(input).toEqual(source());
  });
  it('preserves the original on failure and identifies the failing step', async () => {
    const cause = new Error('broken');
    const engine = createVersioning()
      .addMigration({
        ...first,
        transform: (v: V1): V2 => {
          v.nested.tags.push('b');
          throw cause;
        },
      })
      .build();
    const input = source();
    await expect(engine.migrate(input, '2')).rejects.toMatchObject({
      code: 'TRANSFORM_FAILED',
      cause,
      step: { from: '1.0.0', to: '2.0.0' },
    });
    expect(input).toEqual(source());
  });
  it('requires explicit reverse migrations', async () => {
    const engine = builder().build();
    expect(() => engine.plan('3', '1')).toThrowError(expect.objectContaining({ code: 'NO_PATH' }));
    const reversible = createVersioning()
      .addMigration(first)
      .addMigration({
        from: '2',
        to: '1',
        transform: (v: V2): V1 => ({ name: v.displayName, nested: v.nested }),
      })
      .build();
    expect(
      await reversible.migrate(
        { version: '2', data: { displayName: 'B', nested: { tags: [] } } },
        '1',
      ),
    ).toEqual({ version: '1', data: { name: 'B', nested: { tags: [] } } });
  });
  it('supports custom cloning for special data', async () => {
    class User {
      constructor(readonly name: string) {}
    }
    const engine = createVersioning({ clone: (v) => new User((v as User).name) })
      .addMigration({
        from: '1',
        to: '2',
        transform: (v: User) => {
          expect(v).toBeInstanceOf(User);
          return v.name;
        },
      })
      .build();
    expect(await engine.migrate({ version: '1', data: new User('B') }, '2')).toEqual({
      version: '2',
      data: 'B',
    });
  });
  it('reports clone failures', async () => {
    const engine = createVersioning()
      .addMigration({ from: '1', to: '2', transform: (f: () => void) => f() })
      .build();
    await expect(engine.migrate({ version: '1', data: () => {} }, '2')).rejects.toMatchObject({
      code: 'CLONE_FAILED',
    });
  });
});

describe('optional runtime validation', () => {
  it('validates selected source/intermediate/target boundaries once in order', async () => {
    const calls: string[] = [];
    const engine = builder()
      .addVersion('1', {
        validate: (v) => {
          calls.push('1');
          return typeof (v as V1).name === 'string';
        },
      })
      .addVersion('2', {
        validate: async (v) => {
          calls.push('2');
          return typeof (v as V2).displayName === 'string';
        },
      })
      .addVersion('3', {
        validate: (v) => {
          calls.push('3');
          return (v as V3).active === true;
        },
      })
      .build();
    await engine.migrate(source(), '3');
    expect(calls).toEqual(['1', '2', '3']);
    await expect(engine.migrateUnknown({ version: '1', data: {} }, '3')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
  it('supports validating only the final output', async () => {
    const engine = builder()
      .addVersion('3', { validate: () => false })
      .build();
    await expect(engine.migrate(source(), '3')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      step: { from: '2.0.0', to: '3.0.0' },
    });
  });
  it('preserves thrown validator causes', async () => {
    const cause = new Error('invalid');
    const engine = builder()
      .addVersion('1', {
        validate: () => {
          throw cause;
        },
      })
      .build();
    await expect(engine.migrate(source(), '1')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      cause,
    });
  });
  it('validates no-op migrations', async () => {
    await expect(
      builder()
        .addVersion('1', { validate: () => false })
        .build()
        .migrate(source(), '1'),
    ).rejects.toBeInstanceOf(MigrationError);
  });
});

describe('registration and path planning', () => {
  it('rejects invalid and duplicate edges/validators', () => {
    expect(() => createVersioning().addVersion('01')).toThrowError(
      expect.objectContaining({ code: 'INVALID_VERSION' }),
    );
    expect(() =>
      createVersioning()
        .addMigration(first)
        .addMigration({ ...first, from: '1.0.0', to: '2.0.0' }),
    ).toThrowError(expect.objectContaining({ code: 'DUPLICATE_MIGRATION' }));
    expect(() =>
      createVersioning()
        .addVersion('1', { validate: () => true })
        .addVersion('1.0.0', { validate: () => true }),
    ).toThrowError(expect.objectContaining({ code: 'DUPLICATE_VALIDATOR' }));
  });
  it('rejects unknown versions before transformation', () => {
    expect(() => builder().build().plan('9', '3')).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_VERSION' }),
    );
  });
  it('rejects ambiguous paths including shortcuts', () => {
    const engine = builder()
      .addMigration({
        from: '1',
        to: '3',
        transform: (v: V1): V3 => ({ displayName: v.name, nested: v.nested, active: true }),
      })
      .build();
    expect(() => engine.plan('1', '3')).toThrowError(
      expect.objectContaining({ code: 'AMBIGUOUS_PATH' }),
    );
  });
  it('ignores unreachable branches and disallows overshooting', () => {
    const engine = createVersioning()
      .addMigration(first)
      .addMigration({ from: '1', to: '4', transform: (v: V1) => v.name })
      .addMigration({ from: '4', to: '3', transform: (v: string) => v.length })
      .build();
    expect(engine.plan('1', '2')).toHaveLength(1);
    expect(() => engine.plan('1', '3')).toThrowError(expect.objectContaining({ code: 'NO_PATH' }));
  });
  it('builder branches and built instances are independent', () => {
    const base = createVersioning().addMigration(first),
      engine = base.build();
    base.addMigration(second).build();
    expect(() => engine.plan('1', '3')).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_VERSION' }),
    );
    expect(base.addMigration(second).build().plan('1', '3')).toHaveLength(2);
  });
  it('does not expose mutable plan state', () => {
    const engine = builder().build(),
      plan = engine.plan('1', '3');
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan[0])).toBe(true);
    expect(Object.keys(plan[0]!)).toEqual(['from', 'to']);
  });
  it('treats build metadata as the same schema identity', () => {
    expect(builder().build().plan('1.0.0+build', '2.0.0+other')).toHaveLength(1);
  });
});

it('adapts existing version fields and preserves unrelated resource fields', async () => {
  const resource: { id: string; schemaVersion: string; payload: unknown } = {
    id: 'abc',
    schemaVersion: '1',
    payload: source().data,
  };
  const migrated = await migrateResource(builder().build(), resource, '3', {
    read: (r) => ({ version: r.schemaVersion, data: r.payload }),
    write: (r, v) => ({
      ...r,
      schemaVersion: v.version,
      payload: v.data,
    }),
  });
  expect(migrated.schemaVersion).toBe('3');
  expect(migrated.id).toBe('abc');
  expect(migrated.payload).toMatchObject({ displayName: 'Bruno', active: true });
  expect(resource.schemaVersion).toBe('1');
  expect(resource.payload).toEqual(source().data);
});

// Compile-time contract tests: never executed, but checked by tsc.
function typeContracts() {
  const b = createVersioning().addMigration(first);
  // @ts-expect-error incompatible type for an already-known source version
  b.addMigration({ from: '2', to: '3', transform: (v: number) => String(v) });
  // @ts-expect-error aliases must have compatible types too
  b.addMigration({ from: '2.0.0', to: '3', transform: (v: number) => String(v) });
  // @ts-expect-error destination type conflicts with registered schema
  b.addMigration({ from: '0', to: '1', transform: (v: string) => v.length });
  // @ts-expect-error same canonical source and destination
  b.addMigration({ from: '1', to: '1.0.0', transform: (v: V1) => v });
  // @ts-expect-error incorrect source payload
  b.build().migrate({ version: '1', data: 4 }, '2');
  // @ts-expect-error unknown target
  b.build().migrate(source(), '3');
  // @ts-expect-error unknown source
  b.build().migrate({ version: '9', data: source().data }, '2');
}
void typeContracts;

it('contextually types a known migration input', async () => {
  const engine = createVersioning()
    .addMigration(first)
    .addMigration({
      from: '2',
      to: '3',
      transform: (v) => {
        expectTypeOf(v).toEqualTypeOf<V2>();
        return v.displayName.length;
      },
    })
    .build();
  const result = await engine.migrate(source(), '3');
  expectTypeOf(result.data).toEqualTypeOf<number>();
  expect(result.data).toBe(5);
});

it('plans a long chain without recursive traversal', () => {
  let b = createVersioning();
  for (let i = 0; i < 1500; i++)
    b = b.addMigration({ from: String(i), to: String(i + 1), transform: (v: unknown) => v });
  expect(b.build().plan('0', '1500')).toHaveLength(1500);
});

it('allows a validator-only version and later typed migration registration', async () => {
  const base = createVersioning().addVersion('1', {
    validate: (value) => typeof value === 'number',
  });
  expect(await base.build().migrateUnknown({ version: '1', data: 5 }, '1')).toEqual({
    version: '1',
    data: 5,
  });
  const engine = base
    .addMigration({ from: '1', to: '2', transform: (v: number) => String(v) })
    .build();
  expect(await engine.migrate({ version: '1', data: 5 }, '2')).toEqual({ version: '2', data: '5' });
});

it('rejects equivalent endpoints at runtime when versions are dynamic', () => {
  const from: string = '1';
  const to: string = '1.0.0+build';
  expect(() =>
    createVersioning().addMigration({ from, to, transform: (v: unknown) => v }),
  ).toThrowError(expect.objectContaining({ code: 'DUPLICATE_MIGRATION' }));
});
