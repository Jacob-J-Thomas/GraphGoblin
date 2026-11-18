import { it } from 'vitest';
import { runS1 } from './s1-scenario.js';

it('QA407 S1 worker B', () => runS1('B'), 240_000);
