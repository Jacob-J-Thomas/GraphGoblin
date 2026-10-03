import '@xyflow/react/dist/style.css';
import './index.css';
import { bootstrap } from './app/bootstrap.js';

bootstrap(document.getElementById('root') as HTMLElement, {
  registerServiceWorker: import.meta.env.PROD,
});
