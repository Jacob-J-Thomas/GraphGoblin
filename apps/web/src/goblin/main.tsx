import './goblin.css';
import { bootstrapGoblin } from './bootstrap.js';

bootstrapGoblin(document.getElementById('root') as HTMLElement, {
  registerServiceWorker: import.meta.env.PROD,
});
