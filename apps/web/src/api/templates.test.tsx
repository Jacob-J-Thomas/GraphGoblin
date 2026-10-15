import { screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useTemplates } from './queries.js';
import { FakeApi, starterTemplateEntry } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';

function Catalog() {
  const list = useTemplates();
  return <output data-testid="catalog-count">{list.data?.length ?? 'loading'}</output>;
}
it('loads the manifest-only catalogue without an instance lookup', async () => {
  const api = new FakeApi();
  api.templates = [starterTemplateEntry()];
  renderWith(<Catalog />, '/', api);
  await waitFor(() => expect(screen.getByTestId('catalog-count')).toHaveTextContent('1'));
  expect(api.callsTo('GET', '/templates')).toHaveLength(1);
  expect(api.callsTo('GET', /template-instances/)).toHaveLength(0);
});
