import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

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

class DOMMatrixStub {
  m22 = 1;
  constructor(_init?: string) {}
}
globalThis.DOMMatrixReadOnly ??= DOMMatrixStub as unknown as typeof DOMMatrixReadOnly;

// jsdom has no modal top layer. Edge tests exercise native focus containment and Escape.
HTMLDialogElement.prototype.showModal ??= function showModal() {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function close() {
  this.open = false;
};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});
