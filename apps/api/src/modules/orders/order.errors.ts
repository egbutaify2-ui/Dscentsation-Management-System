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

export function orderForbidden(): OrderError {
  return new OrderError(
    'The current user cannot view product records for order capture.',
    403,
    'FORBIDDEN',
  );
}

export function orderLocationForbidden(): OrderError {
  return new OrderError(
    'You are not authorised to use this fulfilment location.',
    403,
    'LOCATION_ACCESS_DENIED',
  );
}
