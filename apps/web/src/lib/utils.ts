import { GraphGoblinApiError, NETWORK_ERROR_STATUS } from '@graphgoblin/api-client';
import { clsx, type ClassValue } from 'clsx';

/** Join class names; falsy values are dropped. */
export function cn(...classes: ClassValue[]): string {
  return clsx(classes);
}

/** A short local date and time, or a dash when absent. */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

/** Pretty JSON for display. `undefined` renders as an empty string. */
export function prettyJson(value: unknown): string {
  if (value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

/** True when the error means the backend could not be reached. */
export function isOfflineError(error: unknown): boolean {
  return error instanceof GraphGoblinApiError && error.status === NETWORK_ERROR_STATUS;
}

/** A one-line human message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof GraphGoblinApiError) {
    if (error.status === NETWORK_ERROR_STATUS) return 'The GraphGoblin API cannot be reached.';
    const base = error.detail ? `${error.detail} (${error.code})` : error.code;
    // A schema refusal alone does not say which field was wrong; name the first one.
    const first = error.code === 'VALIDATION_FAILED' ? problemIssues(error)[0] : undefined;
    return first ? `${base}: ${first}` : base;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Problem-details `errors` as a list of strings, for 400 and 422 responses. */
export function problemIssues(error: unknown): string[] {
  if (!(error instanceof GraphGoblinApiError)) return [];
  const details =
    error.code === 'LOOP_IMPORT_ERROR' &&
    typeof error.errors === 'object' &&
    error.errors !== null &&
    'errors' in error.errors
      ? error.errors.errors
      : error.errors;
  if (!Array.isArray(details)) return [];
  return details.map((item: unknown) => {
    if (typeof item === 'object' && item !== null && 'message' in item) {
      const where =
        'nodeId' in item && typeof item.nodeId === 'string'
          ? `${item.nodeId}: `
          : 'path' in item && typeof item.path === 'string' && item.path
            ? `${item.path}: `
            : '';
      return `${where}${String(item.message)}`;
    }
    return String(item);
  });
}

/** Offer a JSON document as a file download. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** A filesystem-friendly slug for download names. */
export function fileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'loop';
}

/** Parse JSON text, returning a discriminated result instead of throwing. */
export function parseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
