export class TemplateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}
export function unavailable(message: string): never {
  throw new TemplateError('TEMPLATE_PREREQUISITES_UNAVAILABLE', message);
}
