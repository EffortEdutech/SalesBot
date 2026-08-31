import { AppError } from '@frontdesk-q/contracts';

export function pricingError(code: string, detail?: string): AppError {
  switch (code) {
    case 'OFFERING_NOT_FOUND':
      return new AppError(
        'OFFERING_NOT_FOUND',
        detail ?? code,
        404,
        false,
        'I could not find that approved offering.',
      );
    case 'PRICE_BOOK_NOT_FOUND':
      return new AppError(
        'PRICE_BOOK_NOT_FOUND',
        detail ?? code,
        422,
        false,
        'No active price book is configured.',
      );
    case 'PRICE_BOOK_NOT_ACTIVE':
      return new AppError(
        'PRICE_BOOK_NOT_ACTIVE',
        detail ?? code,
        422,
        false,
        'The current price book cannot be used.',
      );
    case 'PRICE_BOOK_EXPIRED':
      return new AppError(
        'PRICE_BOOK_EXPIRED',
        detail ?? code,
        422,
        false,
        'The current price book requires review.',
      );
    case 'UNIT_MISMATCH':
      return new AppError(
        'UNIT_MISMATCH',
        detail ?? code,
        422,
        false,
        'The requested unit does not match the approved rate.',
      );
    case 'PRICE_NOT_FOUND':
    default:
      return new AppError(
        'PRICE_NOT_FOUND',
        detail ?? code,
        422,
        false,
        'I could not find a current approved price.',
      );
  }
}
