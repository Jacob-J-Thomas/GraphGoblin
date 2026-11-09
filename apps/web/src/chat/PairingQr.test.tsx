import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PairingQr } from './PairingQr.js';
it('renders a long LAN gateway pairing URL locally without requesting an external QR service', () => {
  const host = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.home`;
  render(<PairingQr url={`https://${host}:9443/goblin/#pair=${'A'.repeat(43)}`} />);
  expect(screen.getByRole('img', { name: /Scan this pairing link/ })).toHaveAttribute(
    'src',
    expect.stringContaining('data:image/gif;base64,'),
  );
});
