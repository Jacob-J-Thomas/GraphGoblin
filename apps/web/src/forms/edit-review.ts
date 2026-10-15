import { createContext } from 'react';

export interface FormEditRequest {
  type: 'variant' | 'remove';
  path: string;
  value: unknown;
  index?: number;
}

/** Review before touching either form values or held text. A cancelled edit has no writes. */
export const FormEditReviewContext = createContext<
  (request: FormEditRequest, apply: (value: unknown, keep?: readonly string[]) => void) => void
>((request, apply) => apply(request.value));

export const ReorderablePathsContext = createContext<readonly string[]>([]);
