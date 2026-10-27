import { readFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';

if (basename(process.argv[1] ?? '') === 'exec') {
  readFileSync(0);
  const mode = process.env.GG_RV_426_CASE;
  const emit = (event) => writeSync(1, JSON.stringify(event) + '\n');
  emit({ type: 'thread.started', thread_id: 'audit-thread' });
  emit({ type: 'turn.started' });
  if (mode === 'invalid-value' || mode === 'missing-thread-text') {
    const message = JSON.stringify({
      status: 400,
      error: {
        type: 'invalid_request_error',
        param: 'reasoning.effort',
        message: mode === 'invalid-value'
          ? "Error: invalid value for reasoning.effort: 'minimal'."
          : 'Thread not found in referenced input.',
      },
    });
    emit({ type: 'error', message });
    emit({ type: 'turn.failed', error: { message } });
  } else {
    emit({ type: 'error', message: 'An earlier generic diagnostic' });
    if (mode === 'completed') {
      emit({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } });
    }
    if (mode === 'parse' || mode === 'completed') writeSync(1, 'MALFORMED_PROTOCOL_ITEM\n');
    else emit({ type: 'turn.failed', error: { message: 'An earlier generic diagnostic' } });
  }
  writeSync(2, mode === 'auth' ? 'Error: Not logged in\n' : 'Reading prompt from stdin...\n');
  process.exit(mode === 'parse' || mode === 'completed' ? 0 : 1);
}
