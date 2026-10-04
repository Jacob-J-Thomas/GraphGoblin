const id = '#abc';
const whitePaper = 'A white paper describes black boxes.';
export const page = (
  <div
    id={id}
    title={whitePaper}
    className="bg-surface-app text-text-default hover:bg-accent-subtle border-[var(--border-strong)] text-[10px] ring-transparent fill-current"
    style={{ color: 'var(--text-default)' }}
  />
);
