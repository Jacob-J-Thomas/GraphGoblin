import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { useApiKeyStore } from '../api/api-key.js';
import { dialogClose } from './dialog.js';

// Whole-app renders under a busy parallel run can take longer than the 1 s default.
configure({ asyncUtilTimeout: 5000 });

// jsdom lacks the layout APIs that @xyflow/react and CodeMirror call; give them inert versions.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const emptyRects = (): DOMRectList => Object.assign([], { item: () => null });
const zeroRect = (): DOMRect => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
});
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= zeroRect;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

// jsdom has HTMLDialogElement but not showModal or close. A minimal stand-in: showModal sets the
// open attribute, close removes it and fires `close` as a queued task, as browsers do (or at once,
// see __fixtures__/dialog.ts), and Esc fires a cancelable `cancel` at the open dialog, closing it
// unless a handler prevents that. There is no top layer or inertness; tests of those run in the
// browser (e2e).
const dialogPrototype: Pick<HTMLDialogElement, 'showModal' | 'close'> = HTMLDialogElement.prototype;
if (!Object.hasOwn(HTMLDialogElement.prototype, 'showModal')) {
  dialogPrototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialogPrototype.close = function close(this: HTMLDialogElement, value?: string) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    if (value !== undefined) this.returnValue = value;
    if (dialogClose.delivery === 'sync') this.dispatchEvent(new Event('close'));
    else setTimeout(() => this.dispatchEvent(new Event('close')), 0);
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
  });
}

class DOMMatrixStub {
  m22 = 1;
  constructor(_init?: string) {}
}
globalThis.DOMMatrixReadOnly ??= DOMMatrixStub as unknown as typeof DOMMatrixReadOnly;

afterEach(() => {
  cleanup();
  // The API key store is module state that outlives each test's app. Reset it only after the
  // unmount: changing the key while the app is mounted refetches every query, and a refetch
  // answered 401 without a key marks the store rejected again, so the next test would render the
  // API key panel, which takes focus as soon as no dialog is open.
  useApiKeyStore.getState().forget();
  dialogClose.delivery = 'task';
  sessionStorage.clear();
  localStorage.clear();
});
