import { readFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';
if (basename(process.argv[1] ?? '') === 'exec') {
  readFileSync(0);
  const spec = JSON.parse(process.env.GG_AUDIT_SPEC);
  for (const event of spec.events ?? []) writeSync(1, JSON.stringify(event) + '\n');
  if (spec.malformed) writeSync(1, 'MALFORMED_PROTOCOL_ITEM\n');
  writeSync(2, spec.stderr ?? '');
  process.exit(spec.exit ?? 1);
}
