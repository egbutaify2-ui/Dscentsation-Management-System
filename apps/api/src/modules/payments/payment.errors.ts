export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export function paymentNotFound(): PaymentError {
  return new PaymentError('The requested payment or order was not found.', 404, 'NOT_FOUND');
}

export function paymentConflict(message: string, code = 'PAYMENT_CONFLICT'): PaymentError {
  return new PaymentError(message, 409, code);
}

export function paymentInvalid(message: string): PaymentError {
  return new PaymentError(message, 400, 'INVALID_REQUEST');
}
