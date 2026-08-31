export interface Connection {
  baseUrl: string;
  tenantId: string;
  token: string;
}

export interface Overview {
  new_intakes_24h: number;
  pending_approval: number;
  needs_review: number;
  sent_24h: number;
  pending_approval_value: number;
  upstream_unknown: number;
}

export interface SystemDiagnostics {
  bridge: {
    status: 'connected';
    app_env: string;
    port: number;
  };
  database: {
    status: 'connected';
  };
  migrations: {
    status: 'ready' | 'incomplete';
    expected_tables: number;
    present_tables: number;
    missing_tables: string[];
    missing_columns: string[];
  };
  tenant: {
    status: string;
    id: string;
    name: string;
    industry: string;
    currency: string;
    timezone: string;
  };
  operator: {
    status: 'authenticated';
    token_id: string;
    name: string;
    role: string;
  };
  bidwright: {
    status: 'not_configured' | 'reachable' | 'unreachable';
    configured: boolean;
    reachable: boolean | null;
    base_url: string | null;
  };
  price_book:
    | {
        status: string;
        id: string;
        name: string;
        currency: string;
        effective_date: string;
        expiry_date: string | null;
      }
    | { status: 'missing' };
  dograh: {
    status: string;
    last_verified_at: string | null;
  };
}

export interface QuoteRow {
  id: string;
  customer_name: string | null;
  status: string;
  revision_number: number;
  currency: string;
  grand_total: number | null;
  bidwright_revision_id: string | null;
  updated_at: string;
}

export interface IntakeRow {
  id: string;
  customer_name: string | null;
  phone: string | null;
  source_channel: string;
  service_intent: string | null;
  status: string;
  created_at: string;
}

export interface OperationRow {
  id: string;
  operation_type: string;
  idempotency_key: string;
  status: string;
  current_step: string | null;
  last_error_code: string | null;
  attempt_count: number;
  updated_at: string;
}

export interface Offering {
  offering_ref: string;
  type: 'product' | 'service';
  name: string;
  code: string;
  uom: string;
  match_confidence: number;
  price_disclosure: 'allowed' | 'quote_only' | 'range_only' | 'human_only';
}

export interface QuoteDetail {
  ok: true;
  quote: QuoteRow & {
    quote_number: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    title: string | null;
    scope: string | null;
    approval_status: string | null;
    subtotal: number | null;
    markup: number | null;
    tax: number | null;
    bidwright_project_id: string | null;
    bidwright_quote_id: string | null;
    bidwright_worksheet_id: string | null;
    bidwright_rate_schedule_snapshot_id: string | null;
    calculation_hash: string | null;
    validation: { blocking_reasons?: string[]; warnings?: string[] };
    service_intent: string | null;
    requirements: Record<string, unknown>;
    location: Record<string, unknown>;
    intake_notes: string | null;
    created_at: string;
  };
  items: Array<{
    id: string;
    offering_ref: string | null;
    item_type: string;
    description: string;
    quantity: number;
    uom: string;
    unit_price: number | null;
    extended_price: number | null;
    bidwright_item_id: string | null;
    bidwright_rate_schedule_item_id: string | null;
  }>;
  approvals: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
}

export interface PdfDownload {
  blob: Blob;
  filename: string;
  sha256: string;
}
export class BridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function base(value: string) {
  const x = value.trim() || '/bridge';
  return x.endsWith('/') ? x.slice(0, -1) : x;
}

function requestUrls(value: string, path: string) {
  const primary = `${base(value)}${path}`;
  if (base(value) === '/bridge') return [primary, `http://127.0.0.1:4170${path}`];
  return [primary];
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function filenameFromDisposition(value: string | null, fallback: string) {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}
export class BridgeClient {
  constructor(
    private readonly c: Connection,
    private readonly f: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private async req<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    headers.set('authorization', `Bearer ${this.c.token}`);
    headers.set('x-tenant-id', this.c.tenantId);
    headers.set('x-request-id', `salesbot-web:${crypto.randomUUID()}`);
    if (idempotencyKey) headers.set('x-idempotency-key', idempotencyKey);
    if (init.body) headers.set('content-type', 'application/json');

    const attempted: string[] = [];
    let lastNetworkError: unknown = null;

    for (const url of requestUrls(this.c.baseUrl, path)) {
      attempted.push(url);
      let response: Response;
      try {
        response = await this.f(url, { ...init, headers });
      } catch (error) {
        lastNetworkError = error;
        continue;
      }

      const ct = response.headers.get('content-type') || '';
      const body: any = ct.includes('application/json')
        ? await response.json().catch(() => ({}))
        : await response.text();

      if (!response.ok) {
        throw new BridgeError(
          body?.error?.code || `HTTP_${response.status}`,
          body?.error?.user_safe_message || body?.error?.message || `HTTP ${response.status}`,
        );
      }
      return body as T;
    }

    const suffix = attempted.length ? ` Tried: ${attempted.join(', ')}` : '';
    const detail = lastNetworkError instanceof Error ? ` (${lastNetworkError.message})` : '';
    throw new BridgeError(
      'BRIDGE_UNREACHABLE',
      `SalesBot Bridge is not reachable. Start the development platform and try again.${detail}${suffix}`,
    );
  }


  private async reqBlob(path: string): Promise<{ blob: Blob; response: Response }> {
    const headers = new Headers();
    headers.set('accept', 'application/pdf');
    headers.set('authorization', `Bearer ${this.c.token}`);
    headers.set('x-tenant-id', this.c.tenantId);
    headers.set('x-request-id', `salesbot-web:${crypto.randomUUID()}`);

    const attempted: string[] = [];
    let lastNetworkError: unknown = null;
    for (const url of requestUrls(this.c.baseUrl, path)) {
      attempted.push(url);
      let response: Response;
      try {
        response = await this.f(url, { headers });
      } catch (error) {
        lastNetworkError = error;
        continue;
      }
      if (!response.ok) {
        const body: any = (response.headers.get('content-type') || '').includes('application/json')
          ? await response.json().catch(() => ({}))
          : await response.text();
        throw new BridgeError(
          body?.error?.code || `HTTP_${response.status}`,
          body?.error?.user_safe_message || body?.error?.message || `HTTP ${response.status}`,
        );
      }
      return { blob: await response.blob(), response };
    }
    const suffix = attempted.length ? ` Tried: ${attempted.join(', ')}` : '';
    const detail = lastNetworkError instanceof Error ? ` (${lastNetworkError.message})` : '';
    throw new BridgeError('BRIDGE_UNREACHABLE', `SalesBot Bridge is not reachable.${detail}${suffix}`);
  }
  overview() {
    return this.req<Overview>('/v1/operator/overview');
  }

  system() {
    return this.req<SystemDiagnostics>('/v1/operator/system');
  }

  intakes() {
    return this.req<{ items: IntakeRow[] }>('/v1/operator/intakes?limit=100');
  }

  quotes() {
    return this.req<{ items: QuoteRow[] }>('/v1/operator/quotes?limit=100');
  }

  operations() {
    return this.req<{ items: OperationRow[] }>('/v1/operator/operations?limit=100');
  }
  quoteDetail(id: string) {
    return this.req<QuoteDetail>(`/v1/operator/quotes/${encodeURIComponent(id)}`);
  }

  approveQuote(id: string, note: string) {
    return this.req<any>(
      `/v1/quotes/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: JSON.stringify({ note }) },
      `salesbot-web:${id}:approve:${crypto.randomUUID()}`,
    );
  }

  rejectQuote(id: string, reason: string) {
    return this.req<any>(
      `/v1/quotes/${encodeURIComponent(id)}/reject`,
      { method: 'POST', body: JSON.stringify({ reason }) },
      `salesbot-web:${id}:reject:${crypto.randomUUID()}`,
    );
  }

  requestQuoteChanges(id: string, change_request: string) {
    return this.req<any>(
      `/v1/quotes/${encodeURIComponent(id)}/request-changes`,
      { method: 'POST', body: JSON.stringify({ change_request }) },
      `salesbot-web:${id}:changes:${crypto.randomUUID()}`,
    );
  }

  async downloadQuotePdf(id: string, quoteNumber?: string | null): Promise<PdfDownload> {
    const { blob, response } = await this.reqBlob(`/v1/quotes/${encodeURIComponent(id)}/pdf`);
    return {
      blob,
      filename: filenameFromDisposition(response.headers.get('content-disposition'), `${quoteNumber || id}.pdf`),
      sha256: await sha256Hex(blob),
    };
  }

  deliverQuote(input: { quote_id: string; channel: 'manual' | 'download'; recipient: string; pdf_sha256: string }) {
    return this.req<any>(
      `/v1/quotes/${encodeURIComponent(input.quote_id)}/deliver`,
      {
        method: 'POST',
        body: JSON.stringify({ channel: input.channel, recipient: input.recipient, pdf_sha256: input.pdf_sha256 }),
      },
      `salesbot-web:${input.quote_id}:deliver:${input.channel}:${input.pdf_sha256}`,
    );
  }

  createIntake(input: {
    caller_name: string;
    phone: string;
    service: string;
    location: string;
    requirements: Record<string, unknown>;
    notes?: string;
    source: 'staff' | 'web' | 'voice';
  }) {
    return this.req<any>(
      '/v1/intakes',
      { method: 'POST', body: JSON.stringify(input) },
      `salesbot-web:intake:${crypto.randomUUID()}`,
    );
  }

  searchOfferings(query: string) {
    return this.req<{ ok: boolean; items: Offering[] }>('/v1/offerings/search', {
      method: 'POST',
      body: JSON.stringify({ query, types: ['product', 'service'], limit: 10 }),
    });
  }

  resolvePrice(input: { offering_ref: string; quantity: number; uom: string }) {
    // Financial safety: no price, cost, markup, tax or total input exists.
    return this.req<any>('/v1/prices/resolve', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  prepareQuote(input: {
    intake_id: string;
    title: string;
    scope: string;
    line_proposals: Array<{ offering_ref: string; quantity: number; uom: string }>;
  }) {
    return this.req<any>(
      '/v1/quotes/prepare',
      { method: 'POST', body: JSON.stringify(input) },
      `salesbot-web:${input.intake_id}:prepare:${crypto.randomUUID()}`,
    );
  }
}
