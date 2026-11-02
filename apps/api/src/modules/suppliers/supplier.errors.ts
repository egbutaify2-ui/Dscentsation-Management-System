export class SupplierError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SupplierError';
  }
}

export function supplierNotFound(): SupplierError {
  return new SupplierError('The requested supplier was not found.', 404, 'NOT_FOUND');
}

export function supplierConflict(message: string, code = 'CONFLICT'): SupplierError {
  return new SupplierError(message, 409, code);
}

export function supplierInvalid(message: string): SupplierError {
  return new SupplierError(message, 400, 'INVALID_REQUEST');
}
