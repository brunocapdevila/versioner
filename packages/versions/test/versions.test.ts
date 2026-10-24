import { describe, expect, it } from 'vitest';
import semver from 'semver';
import fixtures from './fixtures/node-semver.json' with { type: 'json' };
import {
  compare,
  format,
  increment,
  nextVersion,
  normalizeVersion,
  parse,
  previousVersion,
  satisfies,
} from '../src/index.js';
import type { Release } from '../src/index.js';
const strict = (v: unknown): v is string =>
  typeof v === 'string' && /^\d/.test(v) && v.trim() === v && semver.valid(v) !== null;
const loose = (o: unknown) =>
  o === true || (typeof o === 'object' && o !== null && 'loose' in o && Boolean(o.loose));

describe('exact shorthand and strict SemVer', () => {
  it.each([
    [1, '1.0.0'],
    ['1', '1.0.0'],
    ['1.2', '1.2.0'],
    ['1.2.3+foo', '1.2.3+foo'],
  ] as const)('normalizes %s', (v, expected) => expect(normalizeVersion(v)).toBe(expected));
  it.each(['1', '1.2', 'v1.2.3', '01.2.3', '1.2.3-01', '1.2.3+', '1.2.3-a..b', '1.2.3\n'])(
    'rejects non-strict version %s',
    (v) => expect(() => parse(v)).toThrow(),
  );
  it.each([-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '01', '1.02', '', '1-beta'])(
    'rejects invalid shorthand %s',
    (v) => expect(() => normalizeVersion(v)).toThrow(),
  );
  it('ignores build metadata for precedence', () =>
    expect(compare('1.0.0+one', '1.0.0+two')).toBe(0));
  it('orders huge numeric prerelease identifiers accurately', () =>
    expect(compare('1.0.0-99999999999999999', '1.0.0-100000000000000000')).toBe(-1));
  it('freezes parsed values', () => {
    const v = parse('1.2.3-a+b');
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.prerelease)).toBe(true);
  });
  it('selects previous/next registered versions', () => {
    expect(previousVersion('2', ['1', '1.9.0', '3'])).toBe('1.9.0');
    expect(nextVersion('2', ['10', '3', '1'])).toBe('3.0.0');
    expect(previousVersion('0', ['1'])).toBeUndefined();
    expect(nextVersion('3', ['1'])).toBeUndefined();
  });
});

describe('node-semver v7.8.5 fixtures (strict inputs, supported API)', () => {
  for (const [v, major, minor, patch, pre, build] of fixtures['valid-versions']) {
    if (!strict(v)) continue;
    it(`parses ${v}`, () => {
      expect(parse(v)).toEqual({
        major,
        minor,
        patch,
        prerelease: (pre as unknown[]).map(String),
        build,
      });
      expect(format(parse(v))).toBe(v);
    });
  }
  for (const [v, reason] of fixtures['invalid-versions'])
    it(`rejects ${String(reason)}`, () => expect(() => parse(v as string)).toThrow());
  for (const [a, b, options] of fixtures.comparisons) {
    if (loose(options) || !strict(a) || !strict(b)) continue;
    it(`orders ${a} > ${b}`, () => {
      expect(compare(a, b)).toBe(1);
      expect(compare(b, a)).toBe(-1);
    });
  }
  for (const [a, b, options] of fixtures.equality) {
    if (loose(options) || !strict(a) || !strict(b)) continue;
    it(`equates ${a} and ${b}`, () => expect(compare(a, b)).toBe(0));
  }
  for (const kind of ['range-include', 'range-exclude'] as const) {
    for (const [range, version, options] of fixtures[kind]) {
      if (loose(options) || !strict(version) || typeof range !== 'string') continue;
      const includePrerelease =
        typeof options === 'object' && options !== null && 'includePrerelease' in options
          ? Boolean(options.includePrerelease)
          : false;
      it(`${kind}: ${version} / ${range} / pre=${includePrerelease}`, () =>
        expect(satisfies(version, range, { includePrerelease })).toBe(kind === 'range-include'));
    }
  }
  for (const row of fixtures.increments) {
    const [v, release, expected, options, preid] = row;
    // identifierBase and loose parsing are deliberately outside the initial API.
    if (loose(options) || row.length > 5 || typeof v !== 'string' || typeof release !== 'string')
      continue;
    if (semver.valid(v) !== null && !strict(v)) continue;
    it(`increments ${v} / ${release} / ${String(preid)}`, () => {
      const run = () =>
        increment(v, release as Release, typeof preid === 'string' ? preid : undefined);
      if (expected === null) expect(run).toThrow();
      else expect(run()).toBe(expected);
    });
  }
});

it('matches generated npm ranges, including prereleases', () => {
  const ranges = [
    '',
    '*',
    '1',
    '1.2',
    '^0',
    '^0.0',
    '^0.0.1',
    '^0.2.1',
    '^1.2.3',
    '~1',
    '~1.2.3',
    '>1',
    '<=1.2',
    '>=1 <3',
    '1.2 - 2.1',
    '1.2.3 - 2.1.0',
    '^1.2.3-beta.1',
    '>1.2.3-beta.1',
    '1 || >=2.1',
  ];
  for (let major = 0; major < 4; major++)
    for (let minor = 0; minor < 4; minor++)
      for (let patch = 0; patch < 5; patch++) {
        for (const suffix of ['', '-0', '-alpha.1', '-beta.2', '+build'])
          for (const range of ranges)
            for (const includePrerelease of [false, true]) {
              const v = `${major}.${minor}.${patch}${suffix}`;
              expect(
                satisfies(v, range, { includePrerelease }),
                `${v} / ${range} / ${includePrerelease}`,
              ).toBe(semver.satisfies(v, range, { includePrerelease }));
            }
      }
});
it('comparison is transitive and antisymmetric', () => {
  const versions = ['0.0.0-0', '0.0.0', '0.1.0', '1.0.0-a.1', '1.0.0-a.2', '1.0.0', '2.0.0'];
  for (const a of versions)
    for (const b of versions) {
      expect(compare(a, b) + compare(b, a)).toBe(0);
      for (const c of versions)
        if (compare(a, b) <= 0 && compare(b, c) <= 0) expect(compare(a, c)).toBeLessThanOrEqual(0);
    }
});
it('rejects invalid ranges and prereleases by default', () => {
  for (const range of ['garbage', '1.x.2', '^', '1.2.3-01', '>=', '*'.repeat(9000)])
    expect(satisfies('1', range)).toBe(false);
  expect(satisfies('1.2.3-beta.1', '*')).toBe(false);
  expect(satisfies('1.5.0', '1')).toBe(true);
  expect(satisfies('1.5.0', '=1.0.0')).toBe(false);
});
