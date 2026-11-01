export class ProductError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ProductError';
  }
}

export function notFound(message = 'The requested product record was not found.'): ProductError {
  return new ProductError(message, 404, 'NOT_FOUND');
}

export function conflict(message: string): ProductError {
  return new ProductError(message, 409, 'CONFLICT');
}

export function invalid(message: string): ProductError {
  return new ProductError(message, 400, 'INVALID_REQUEST');
}
