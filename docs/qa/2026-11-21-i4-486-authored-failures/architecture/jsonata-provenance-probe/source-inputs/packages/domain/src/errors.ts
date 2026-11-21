/** Base class for domain errors. Each carries a stable code the engine maps to run failures. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class PatchError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('PATCH_ERROR', message, details);
  }
}

export class TemplateError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('TEMPLATE_ERROR', message, details);
  }
}

export class ExpressionError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('EXPRESSION_ERROR', message, details);
  }
}

export class MutationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('MUTATION_ERROR', message, details);
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('INVALID_TRANSITION', message, details);
  }
}
