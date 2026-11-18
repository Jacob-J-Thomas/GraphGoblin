import { it } from 'vitest';
import { runS1 } from './s1-scenario.js';

it('QA407 S1 worker A', () => runS1('A'), 240_000);
