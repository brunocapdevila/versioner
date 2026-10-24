/** SemVer utilities with explicit exact-version shorthand normalization. */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
}
export type VersionInput = string | number;
export type Release =
  'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch' | 'prerelease' | 'release';
export interface RangeOptions {
  readonly includePrerelease?: boolean;
}
const numeric = /^(0|[1-9]\d*)$/;
const identifier = /^[0-9A-Za-z-]+$/;
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
function component(value: string): number {
  const result = Number(value);
  if (!numeric.test(value) || !Number.isSafeInteger(result))
    throw new TypeError(`Invalid version component: ${value}`);
  return result;
}
/** Strict SemVer 2.0 parsing; use normalizeVersion for shorthand. */
export function parse(input: string): Version {
  if (typeof input !== 'string' || input.length > 256)
    throw new TypeError('Invalid SemVer version');
  const m = versionPattern.exec(input);
  if (!m) throw new TypeError(`Invalid SemVer version: ${input}`);
  const prerelease = m[4]?.split('.') ?? [];
  if (prerelease.some((p) => /^\d+$/.test(p) && !numeric.test(p)))
    throw new TypeError(`Invalid prerelease: ${input}`);
  return Object.freeze({
    major: component(m[1]!),
    minor: component(m[2]!),
    patch: component(m[3]!),
    prerelease: Object.freeze(prerelease),
    build: Object.freeze(m[5]?.split('.') ?? []),
  });
}
export function format(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease.length ? `-${v.prerelease.join('.')}` : ''}${v.build.length ? `+${v.build.join('.')}` : ''}`;
}
/** Exact shorthand: 1 / "1" -> "1.0.0", "1.2" -> "1.2.0". */
export function normalizeVersion(input: VersionInput): string {
  if (typeof input !== 'string' && typeof input !== 'number')
    throw new TypeError('Version must be a string or number');
  if (typeof input === 'number' && (!Number.isSafeInteger(input) || input < 0))
    throw new TypeError('Numeric versions must be non-negative safe integers');
  const value = String(input);
  const expanded = numeric.test(value)
    ? `${value}.0.0`
    : /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
      ? `${value}.0`
      : value;
  return format(parse(expanded));
}
function cmp<T extends string | number | bigint>(a: T, b: T): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareParsed(a: Version, b: Version): -1 | 0 | 1 {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const n = cmp(a[key], b[key]);
    if (n) return n;
  }
  if (!a.prerelease.length || !b.prerelease.length)
    return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i],
      y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    const n = xn && yn ? cmp(BigInt(x), BigInt(y)) : xn !== yn ? (xn ? -1 : 1) : cmp(x, y);
    if (n) return n;
  }
  return 0;
}
/** SemVer precedence ignores build metadata. */
export function compare(a: VersionInput, b: VersionInput): -1 | 0 | 1 {
  return compareParsed(parse(normalizeVersion(a)), parse(normalizeVersion(b)));
}
export function increment(input: VersionInput, release: Release = 'patch', preid?: string): string {
  const v = parse(normalizeVersion(input));
  let { major, minor, patch } = v;
  let pre = [...v.prerelease];
  const bumpPre = () => {
    let changed = false;
    for (let i = pre.length - 1; i >= 0; i--)
      if (/^\d+$/.test(pre[i]!)) {
        pre[i] = String(BigInt(pre[i]!) + 1n);
        changed = true;
        break;
      }
    if (!changed) pre.push('0');
    if (preid !== undefined) {
      const parts = preid.split('.');
      if (!parts.every((p) => identifier.test(p) && (!/^\d+$/.test(p) || numeric.test(p))))
        throw new TypeError('Invalid prerelease identifier');
      if (!parts.every((p, i) => pre[i] === p) || !/^\d+$/.test(pre[parts.length] ?? ''))
        pre = [...parts, '0'];
    }
  };
  switch (release) {
    case 'major':
      if (minor || patch || !pre.length) major++;
      minor = patch = 0;
      pre = [];
      break;
    case 'minor':
      if (patch || !pre.length) minor++;
      patch = 0;
      pre = [];
      break;
    case 'patch':
      if (!pre.length) patch++;
      pre = [];
      break;
    case 'premajor':
      major++;
      minor = patch = 0;
      pre = [];
      bumpPre();
      break;
    case 'preminor':
      minor++;
      patch = 0;
      pre = [];
      bumpPre();
      break;
    case 'prepatch':
      patch++;
      pre = [];
      bumpPre();
      break;
    case 'prerelease':
      if (!pre.length) patch++;
      bumpPre();
      break;
    case 'release':
      if (!pre.length) throw new TypeError('Version is already a release');
      pre = [];
      break;
    default:
      throw new TypeError(`Unknown release: ${String(release)}`);
  }
  const result = format({ major, minor, patch, prerelease: pre, build: [] });
  parse(result);
  return result;
}
type Operator = '' | '=' | '<' | '<=' | '>' | '>=';
interface Comparator {
  op: Operator;
  version: Version;
}
interface PartialVersion {
  major?: number;
  minor?: number;
  patch?: number;
  pre: string;
  build: string;
}
function partial(raw: string): PartialVersion {
  const m =
    /^[v=]?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      raw,
    );
  if (!m) throw new TypeError(`Invalid range version: ${raw}`);
  const parts = [m[1], m[2], m[3]];
  let wildcard = false;
  const nums = parts.map((p) => {
    if (p === undefined || /^[xX*]$/.test(p)) {
      wildcard = true;
      return undefined;
    }
    if (wildcard) throw new TypeError('Numeric component after wildcard');
    return component(p);
  });
  if ((m[4] || m[5]) && nums.some((n) => n === undefined))
    throw new TypeError('Partial version cannot have prerelease or build');
  const out: PartialVersion = { pre: m[4] ? `-${m[4]}` : '', build: m[5] ? `+${m[5]}` : '' };
  if (nums[0] !== undefined) out.major = nums[0];
  if (nums[1] !== undefined) out.minor = nums[1];
  if (nums[2] !== undefined) out.patch = nums[2];
  if (out.patch !== undefined)
    parse(`${out.major}.${out.minor}.${out.patch}${out.pre}${out.build}`);
  return out;
}
function bound(op: Operator, major: number, minor = 0, patch = 0, suffix = ''): Comparator {
  return { op, version: parse(`${major}.${minor}.${patch}${suffix}`) };
}
function expand(token: string, options: RangeOptions): Comparator[] {
  const match = /^(<=|>=|<|>|=|\^|~>|~)?(.+)$/.exec(token);
  if (!match) throw new TypeError('Invalid range comparator');
  const op = match[1] ?? '',
    p = partial(match[2]!);
  const { major: a, minor: b, patch: c } = p;
  if (a === undefined) return op === '<' || op === '>' ? [bound('<', 0, 0, 0, '-0')] : [];
  const low = `${p.pre}${p.build}`;
  const preFloor = options.includePrerelease && c === undefined && !p.pre ? '-0' : low;
  if (op === '^' || op === '~' || op === '~>') {
    let upper: Comparator;
    if (op !== '^')
      upper = b === undefined ? bound('<', a + 1, 0, 0, '-0') : bound('<', a, b + 1, 0, '-0');
    else if (a > 0 || b === undefined) upper = bound('<', a + 1, 0, 0, '-0');
    else if (b > 0 || c === undefined) upper = bound('<', a, b + 1, 0, '-0');
    else upper = bound('<', a, b, c + 1, '-0');
    return [bound('>=', a, b ?? 0, c ?? 0, preFloor), upper];
  }
  if (b !== undefined && c !== undefined) return [bound(op as Operator, a, b, c, low)];
  const next = b === undefined ? ([a + 1, 0] as const) : ([a, b + 1] as const);
  if (op === '>') return [bound('>=', next[0], next[1], 0, options.includePrerelease ? '-0' : '')];
  if (op === '<=') return [bound('<', next[0], next[1], 0, '-0')];
  if (op === '<') return [bound('<', a, b ?? 0, 0, '-0')];
  if (op === '>=') return [bound('>=', a, b ?? 0, 0, options.includePrerelease ? '-0' : '')];
  return [
    bound('>=', a, b ?? 0, 0, options.includePrerelease ? '-0' : ''),
    bound('<', next[0], next[1], 0, '-0'),
  ];
}
function rangeSet(range: string, options: RangeOptions): Comparator[] {
  const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(range);
  if (hyphen) {
    const lo = partial(hyphen[1]!),
      hi = partial(hyphen[2]!);
    const out: Comparator[] = [];
    if (lo.major !== undefined)
      out.push(
        bound(
          '>=',
          lo.major,
          lo.minor ?? 0,
          lo.patch ?? 0,
          lo.pre || (options.includePrerelease ? '-0' : ''),
        ),
      );
    if (hi.major !== undefined) {
      if (hi.minor === undefined) out.push(bound('<', hi.major + 1, 0, 0, '-0'));
      else if (hi.patch === undefined) out.push(bound('<', hi.major, hi.minor + 1, 0, '-0'));
      else if (options.includePrerelease && !hi.pre)
        out.push(bound('<', hi.major, hi.minor, hi.patch + 1, '-0'));
      else out.push(bound('<=', hi.major, hi.minor, hi.patch, hi.pre));
    }
    return out;
  }
  const normalized = range.trim().replace(/(<=|>=|[<>=~^])\s+/g, '$1');
  return normalized ? normalized.split(/\s+/).flatMap((t) => expand(t, options)) : [];
}
/** npm-style ranges. Invalid versions/ranges return false. No loose parsing. */
export function satisfies(input: VersionInput, range: string, options: RangeOptions = {}): boolean {
  try {
    if (typeof range !== 'string' || range.length > 8192) return false;
    const v = parse(normalizeVersion(input));
    const sets = range.split('||').map((r) => rangeSet(r, options));
    return sets.some((set) => {
      if (
        !set.every((c) => {
          const n = compareParsed(v, c.version);
          switch (c.op) {
            case '':
            case '=':
              return n === 0;
            case '<':
              return n < 0;
            case '<=':
              return n <= 0;
            case '>':
              return n > 0;
            case '>=':
              return n >= 0;
          }
        })
      )
        return false;
      return (
        !v.prerelease.length ||
        options.includePrerelease ||
        set.some(
          (c) =>
            c.version.prerelease.length &&
            c.version.major === v.major &&
            c.version.minor === v.minor &&
            c.version.patch === v.patch,
        )
      );
    });
  } catch {
    return false;
  }
}
export function previousVersion(
  current: VersionInput,
  versions: readonly VersionInput[],
): string | undefined {
  return versions
    .map(normalizeVersion)
    .filter((v) => compare(v, current) < 0)
    .sort(compare)
    .at(-1);
}
export function nextVersion(
  current: VersionInput,
  versions: readonly VersionInput[],
): string | undefined {
  return versions
    .map(normalizeVersion)
    .filter((v) => compare(v, current) > 0)
    .sort(compare)
    .at(0);
}
