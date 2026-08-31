import { AppError } from '@frontdesk-q/contracts';
export class BidwrightProviderError extends AppError {
  constructor(
    code:
      | 'BIDWRIGHT_AUTH_FAILED'
      | 'BIDWRIGHT_ORG_MISMATCH'
      | 'BIDWRIGHT_TIMEOUT'
      | 'BIDWRIGHT_UNAVAILABLE'
      | 'BIDWRIGHT_HTTP_ERROR',
    message: string,
    httpStatus: number,
    retryable: boolean,
    public readonly upstreamStatus?: number,
    public readonly upstreamBody?: unknown,
  ) {
    super(
      code,
      message,
      httpStatus,
      retryable,
      retryable
        ? 'The quotation service is temporarily unavailable.'
        : 'The quotation service could not complete the request.',
    );
  }
}
