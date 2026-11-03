export class OrderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

export function invalidOrder(message: string): OrderError {
  return new OrderError(message, 400, 'INVALID_REQUEST');
}

export function orderNotFound(): OrderError {
  return new OrderError('The requested order was not found.', 404, 'NOT_FOUND');
}

export function orderConflict(message: string): OrderError {
  return new OrderError(message, 409, 'CONFLICT');
}
