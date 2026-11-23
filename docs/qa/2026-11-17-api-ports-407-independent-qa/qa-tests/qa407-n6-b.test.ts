import { it } from 'vitest';
import { runN6 } from './n6-stress.js';

it('QA407 N6 stress worker B', () => runN6('B'), 60_000);
