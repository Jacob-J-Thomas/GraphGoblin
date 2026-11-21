import { inject } from 'vitest';
import { setApiPortRoot } from './src/testing/api-port.js';

setApiPortRoot(inject('apiPortRoot'));
