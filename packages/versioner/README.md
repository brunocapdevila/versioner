# versioner

Framework-independent data schema migrations with a typed builder, optional validators, immutable execution, path planning, and resource adapters.

Temporary package name: `@versioner-local/versioner`. Private and unpublished.

```ts
import { createVersioning } from '@versioner-local/versioner';
const engine = createVersioning()
  .addMigration({
    from: '1',
    to: '2',
    transform: (data: { name: string }) => ({ displayName: data.name }),
  })
  .build();
await engine.migrate({ version: '1', data: { name: 'Bruno' } }, '2');
```

See the repository README for type contracts, validation, clone requirements, and path rules.
