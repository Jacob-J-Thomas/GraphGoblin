import { InferenceConfigSchema } from '@graphgoblin/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { SchemaForm } from './SchemaForm.js';

function Form() {
  const [value, setValue] = useState<unknown>(
    InferenceConfigSchema.parse({ prompt: { template: 'task' } }),
  );
  return (
    <>
      <SchemaForm
        schema={InferenceConfigSchema}
        value={value}
        label="inference"
        onChange={setValue}
      />
      <output data-testid="saved">{JSON.stringify(value)}</output>
    </>
  );
}

it('authors opt-in own continuity and an optional visible reset using the schema controls', async () => {
  const user = userEvent.setup();
  render(<Form />);
  const session = screen.getByRole('group', { name: 'Session' });
  const policy = within(session).getByLabelText('Policy');
  expect(policy).toHaveValue('0');
  expect(within(session).queryByLabelText('Reset after visits')).not.toBeInTheDocument();
  expect(within(session).getByText(/Supply current main-loop context deliberately/)).toBeVisible();
  await user.selectOptions(policy, '3');
  const reset = within(session).getByLabelText('Reset after visits');
  expect(reset).toHaveValue(null);
  expect(within(session).getByText(/Blank means no automatic reset/)).toBeVisible();
  await user.type(reset, '2');
  expect(screen.getByTestId('saved')).toHaveTextContent(
    '"session":{"policy":"resume-own","resetAfterVisits":2}',
  );
  await user.clear(reset);
  expect(screen.getByTestId('saved')).toHaveTextContent('"session":{"policy":"resume-own"}');
  await user.type(reset, '0');
  expect(reset).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByTestId('saved')).toHaveTextContent('"session":{"policy":"resume-own"}');
});
