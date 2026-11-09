import { vi } from 'vitest';

export class TestPort {
  peer: TestPort | undefined;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  closed = false;
  postMessage(data: unknown): void {
    queueMicrotask(() => {
      if (!this.peer?.closed) this.peer?.onmessage?.({ data } as MessageEvent<unknown>);
    });
  }
  close(): void {
    this.closed = true;
  }
}

export class TestChannel {
  port1 = new TestPort();
  port2 = new TestPort();
  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

interface Request {
  name: string;
  mode: LockMode;
  callback: (lock: Lock) => unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  aborted: boolean;
  started: boolean;
}

/** FIFO per-name browser Web Lock semantics, including pending abort and shared holders. */
export class TestLocks {
  pending: Request[] = [];
  active: Request[] = [];
  request(name: string, options: LockOptions, callback: Request['callback']): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request: Request = {
        name,
        mode: options.mode ?? 'exclusive',
        callback,
        resolve,
        reject,
        aborted: false,
        started: false,
      };
      const abort = () => {
        if (request.started) return;
        request.aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
        this.drain();
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) {
        abort();
        return;
      }
      this.pending.push(request);
      this.drain();
    });
  }
  private drain(): void {
    for (const request of [...this.pending]) {
      if (request.aborted) {
        this.pending.splice(this.pending.indexOf(request), 1);
        continue;
      }
      const active = this.active.filter((item) => item.name === request.name);
      if (
        active.some((item) => item.mode === 'exclusive') ||
        (request.mode === 'exclusive' && active.length > 0)
      )
        continue;
      const earlier = this.pending
        .slice(0, this.pending.indexOf(request))
        .some((item) => item.name === request.name && !item.aborted);
      if (earlier) continue;
      this.pending.splice(this.pending.indexOf(request), 1);
      request.started = true;
      this.active.push(request);
      queueMicrotask(() => {
        void Promise.resolve(request.callback({ name: request.name, mode: request.mode }))
          .then(request.resolve, request.reject)
          .finally(() => {
            this.active.splice(this.active.indexOf(request), 1);
            this.drain();
          });
      });
    }
  }
}

export async function flush(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

export function setNavigator(key: 'locks' | 'serviceWorker', value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(navigator, key);
  Object.defineProperty(navigator, key, { configurable: true, value });
  return () => {
    if (original) Object.defineProperty(navigator, key, original);
    else Reflect.deleteProperty(navigator, key);
  };
}

export function fakeWorkerContainer() {
  const container = new EventTarget();
  const source = {
    scriptURL: new URL('/app/sw.js', window.location.origin).href,
    postMessage: vi.fn(),
  };
  const message = (data: unknown, port?: TestPort, worker = source) => {
    const event = new MessageEvent('message', { data });
    Object.defineProperties(event, {
      source: { value: worker },
      ports: { value: port ? [port] : [] },
    });
    container.dispatchEvent(event);
  };
  return { container, source, message };
}
