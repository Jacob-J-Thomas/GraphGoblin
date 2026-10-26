import type userEvent from '@testing-library/user-event';

/** Enter fixture text as one real input edit; character-by-character typing is tested separately. */
export async function pasteInto(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  text: string,
) {
  await user.click(field);
  await user.paste(text);
}
