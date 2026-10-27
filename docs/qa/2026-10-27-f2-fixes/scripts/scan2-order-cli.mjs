import { readFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';
if (basename(process.argv[1] ?? '') === 'exec') {
  readFileSync(0);
  const spec = JSON.parse(process.env.GG_AUDIT_ORDER);
  const emit = (event) => writeSync(1, JSON.stringify(event) + '\n');
  emit({ type: 'thread.started', thread_id: 'audit-order-session' });
  for (const symbol of spec.order) {
    if (symbol === 'S') emit({ type: 'turn.started' });
    else {
      const message = symbol === spec.refusal || spec.refusal === 'both'
        ? JSON.stringify({status: 400, error: {type:'invalid_request_error', param:'reasoning.effort', message: spec.text}})
        : 'Earlier unclassified diagnostic';
      if (symbol === 'E') emit({ type: 'error', message });
      if (symbol === 'F') emit({ type: 'turn.failed', error: { message } });
    }
  }
  if (spec.parse) writeSync(1, 'MALFORMED_PROTOCOL_ITEM\n');
  writeSync(2, spec.stderr ?? 'Reading prompt from stdin...\n');
  process.exit(spec.exit);
}
