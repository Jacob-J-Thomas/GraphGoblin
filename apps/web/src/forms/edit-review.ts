import { createContext } from 'react';

export interface FormEditRequest {
  type: 'variant' | 'remove' | 'gate';
  path: string;
  value: unknown;
  index?: number;
}

export type FormEditApply = (
  value: unknown,
  keep?: readonly string[],
  moves?: readonly { from: string; to: string }[],
) => void;

/** Review before touching either form values or held text. A cancelled edit has no writes. */
export const FormEditReviewContext = createContext<
  (request: FormEditRequest, apply: FormEditApply) => void
>((request, apply) => apply(request.value));

export const ReorderablePathsContext = createContext<readonly string[]>([]);
