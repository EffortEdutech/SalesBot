export type BridgeErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'OPERATOR_IDENTITY_NOT_FOUND'
  | 'TENANT_NOT_FOUND'
  | 'TENANT_MISMATCH'
  | 'FORBIDDEN'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'OPERATION_IN_PROGRESS'
  | 'UPSTREAM_STATE_UNKNOWN'
  | 'BIDWRIGHT_AUTH_FAILED'
  | 'BIDWRIGHT_ORG_MISMATCH'
  | 'BIDWRIGHT_TIMEOUT'
  | 'BIDWRIGHT_UNAVAILABLE'
  | 'BIDWRIGHT_HTTP_ERROR'
  | 'OFFERING_NOT_FOUND'
  | 'AMBIGUOUS_OFFERING_MATCH'
  | 'PRICE_NOT_FOUND'
  | 'PRICE_BOOK_NOT_FOUND'
  | 'PRICE_BOOK_NOT_ACTIVE'
  | 'PRICE_BOOK_EXPIRED'
  | 'UNIT_MISMATCH'
  | 'RATE_SNAPSHOT_FAILED'
  | 'RATE_ITEM_NOT_FOUND'
  | 'MISSING_REQUIRED_FIELD'
  | 'QUOTE_NOT_FOUND'
  | 'CALCULATION_FAILED'
  | 'CALCULATION_WARNING_BLOCKING'
  | 'QUOTE_STATE_INVALID'
  | 'QUOTE_APPROVAL_REQUIRED'
  | 'QUOTE_APPROVAL_MISMATCH'
  | 'PDF_GENERATION_FAILED'
  | 'DELIVERY_FAILED'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: BridgeErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly retryable = false,
    public readonly userSafeMessage = 'Something went wrong. Please try again.',
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function toErrorEnvelope(error: AppError, requestId: string) {
  return {
    ok: false as const,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      user_safe_message: error.userSafeMessage,
    },
    request_id: requestId,
  };
}
