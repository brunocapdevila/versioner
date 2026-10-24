import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createVersioning } from '@versioner-local/versioner';
import { compare, normalizeVersion, satisfies } from '@versioner-local/versions';
assert.equal(normalizeVersion(1), '1.0.0');
assert.equal(compare('1', '1.0.0'), 0);
assert.equal(satisfies('1.5.0', '1'), true);
const engine = createVersioning()
  .addMigration({ from: '1', to: '2', transform: (value) => ({ ...value, active: true }) })
  .build();
assert.deepEqual(await engine.migrate({ version: '1', data: { name: 'Bruno' } }, '2'), {
  version: '2',
  data: { name: 'Bruno', active: true },
});
for (const name of ['versions', 'versioner']) {
  const bundle = await build({
    entryPoints: [`packages/${name}/dist/index.js`],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    write: false,
  });
  // Execute the browser-target ESM bundle, with no Node polyfills or external dependencies.
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  );
  assert.ok(
    name === 'versions'
      ? module.normalizeVersion('1') === '1.0.0'
      : typeof module.createVersioning === 'function',
  );
}
console.log('Node ESM imports and both browser-target ESM bundles passed.');
