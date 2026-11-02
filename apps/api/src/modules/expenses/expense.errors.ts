export class ExpenseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ExpenseError';
  }
}

export function notFound(message = 'The requested expense record was not found.'): ExpenseError {
  return new ExpenseError(message, 404, 'NOT_FOUND');
}

export function conflict(message: string): ExpenseError {
  return new ExpenseError(message, 409, 'CONFLICT');
}

export function invalid(message: string): ExpenseError {
  return new ExpenseError(message, 400, 'INVALID_REQUEST');
}

export function forbidden(): ExpenseError {
  return new ExpenseError(
    'You are not authorised to perform this expense operation.',
    403,
    'PERMISSION_DENIED',
  );
}
