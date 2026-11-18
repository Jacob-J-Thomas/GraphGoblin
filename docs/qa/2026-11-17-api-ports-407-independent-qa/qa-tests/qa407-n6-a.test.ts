import { it } from 'vitest';
import { runN6 } from './n6-stress.js';

it('QA407 N6 stress worker A', () => runN6('A'), 60_000);
