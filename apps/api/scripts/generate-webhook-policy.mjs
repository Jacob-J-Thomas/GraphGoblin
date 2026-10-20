// Freeze the current named policy into the one-off migration; run before shipping it.
import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { WEBHOOK_DELIVERY_POLICY } from '@graphgoblin/contracts';
const file = new URL(
  '../../../packages/infrastructure/drizzle/0015_webhook_delivery_journal.sql',
  import.meta.url,
);
const sql = await readFile(file, 'utf8');
await writeFile(
  file,
  sql.replace(
    /'attempts', 1, 'maxAttempts', \d+,\s*\n {4}'inFlight'/,
    `'attempts', 1, 'maxAttempts', ${WEBHOOK_DELIVERY_POLICY.maxAttempts},\n    'inFlight'`,
  ),
);
