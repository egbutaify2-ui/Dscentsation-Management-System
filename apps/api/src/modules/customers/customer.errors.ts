export class CustomerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CustomerError';
  }
}

export function notFound(message = 'The requested customer was not found.'): CustomerError {
  return new CustomerError(message, 404, 'NOT_FOUND');
}

export function invalid(message: string): CustomerError {
  return new CustomerError(message, 400, 'INVALID_REQUEST');
}

export function forbidden(message = 'You are not authorised to perform this customer operation.'): CustomerError {
  return new CustomerError(message, 403, 'PERMISSION_DENIED');
}
