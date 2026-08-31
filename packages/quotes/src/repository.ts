import { randomUUID } from 'node:crypto';
import { AppError } from '@frontdesk-q/contracts';
import type { DbPool } from '@frontdesk-q/db';
import type { BridgeQuoteState, IntakeRecord, QuoteRecord } from './types.js';

export interface CreateIntakeInput {
  tenantId: string;
  customer: { name: string; phone?: string | null; email?: string | null };
  sourceChannel: string;
  dograhWorkflowId?: string | null;
  dograhWorkflowRunId?: string | null;
  serviceIntent?: string | null;
  requirements?: Record<string, unknown>;
  location?: Record<string, unknown>;
  notes?: string | null;
}

export interface QuoteDecisionRecord {
  id: string;
  quoteId: string;
  status: 'approved' | 'rejected' | 'changes_requested';
  bidwrightRevisionId: string;
  calculationHash: string | null;
}

export interface QuoteDeliveryRecord {
  id: string;
  quoteId: string;
  bidwrightRevisionId: string;
  channel: string;
  recipient: string;
  pdfSha256: string;
  status: 'sent';
}

export interface QuoteRepository {
  createIntake(input: CreateIntakeInput): Promise<IntakeRecord>;
  getIntake(tenantId: string, intakeId: string): Promise<IntakeRecord | null>;
  createQuoteShell(input: {
    tenantId: string;
    intakeId: string;
    title: string;
    scope: string;
    providerCorrelation: string;
  }): Promise<QuoteRecord>;
  getQuote(tenantId: string, quoteId: string): Promise<QuoteRecord | null>;
  updateQuote(
    tenantId: string,
    quoteId: string,
    patch: Partial<{
      quoteNumber?: string;
      title: string;
      scope: string;
      providerCorrelation: string;
      bidwrightProjectId: string;
      bidwrightQuoteId: string;
      bidwrightRevisionId: string;
      bidwrightWorksheetId: string;
      bidwrightRateScheduleSnapshotId: string;
      status: BridgeQuoteState;
      currency: string;
      subtotal: number;
      markup: number;
      tax: number;
      grandTotal: number;
      calculationHash: string;
      validation: QuoteRecord['validation'];
    }>,
  ): Promise<void>;
  hasQuoteItem(
    tenantId: string,
    quoteId: string,
    offeringRef: string,
    uom: string,
  ): Promise<boolean>;
  addQuoteItem(input: {
    tenantId: string;
    quoteId: string;
    offeringRef: string;
    itemType: 'product' | 'service';
    bidwrightItemId: string | null;
    bidwrightRateScheduleItemId: string | null;
    description: string;
    quantity: number;
    uom: string;
    unitPrice: number | null;
    extendedPrice: number | null;
  }): Promise<void>;
  approveQuote(input: { tenantId: string; quoteId: string; actorId: string; note?: string | null }): Promise<QuoteDecisionRecord>;
  rejectQuote(input: { tenantId: string; quoteId: string; actorId: string; reason: string }): Promise<QuoteDecisionRecord>;
  requestQuoteChanges(input: { tenantId: string; quoteId: string; actorId: string; changeRequest: string }): Promise<QuoteDecisionRecord>;
  recordDelivery(input: { tenantId: string; quoteId: string; actorId: string; channel: string; recipient: string; pdfSha256: string }): Promise<QuoteDeliveryRecord>;
}

function mapIntake(row: any): IntakeRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    sourceChannel: row.source_channel,
    serviceIntent: row.service_intent,
    requirements: row.requirements_json ?? {},
    location: row.location_json ?? {},
    notes: row.notes,
  };
}

function mapQuote(row: any): QuoteRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    intakeId: row.intake_id,
    quoteNumber: row.quote_number,
    title: row.title,
    scope: row.scope,
    providerCorrelation: row.provider_correlation,
    bidwrightProjectId: row.bidwright_project_id,
    bidwrightQuoteId: row.bidwright_quote_id,
    bidwrightRevisionId: row.bidwright_revision_id,
    bidwrightWorksheetId: row.bidwright_worksheet_id,
    bidwrightRateScheduleSnapshotId: row.bidwright_rate_schedule_snapshot_id,
    status: row.status,
    currency: row.currency,
    subtotal: row.subtotal === null ? null : Number(row.subtotal),
    markup: row.markup === null ? null : Number(row.markup),
    tax: row.tax === null ? null : Number(row.tax),
    grandTotal: row.grand_total === null ? null : Number(row.grand_total),
    calculationHash: row.calculation_hash,
    validation: row.validation_json ?? {},
  };
}

function requirePendingApproval(row: any): void {
  if (!row) {
    throw new AppError(
      'QUOTE_NOT_FOUND',
      'Quote was not found for this tenant',
      404,
      false,
      'The quotation could not be found.',
    );
  }
  if (row.status !== 'pending_approval') {
    throw new AppError(
      'QUOTE_STATE_INVALID',
      `Quote is ${row.status}, not pending_approval`,
      409,
      false,
      'Only quotations pending human approval can be decided.',
    );
  }
  if (!row.bidwright_revision_id || !row.calculation_hash || row.grand_total === null) {
    throw new AppError(
      'QUOTE_STATE_INVALID',
      'Quote is missing revision, calculation hash or total',
      409,
      false,
      'The quotation is not complete enough for approval.',
    );
  }
}

function requireApproved(row: any): void {
  if (!row) {
    throw new AppError(
      'QUOTE_NOT_FOUND',
      'Quote was not found for this tenant',
      404,
      false,
      'The quotation could not be found.',
    );
  }
  if (row.status !== 'approved') {
    throw new AppError(
      'QUOTE_APPROVAL_REQUIRED',
      `Quote is ${row.status}, not approved`,
      409,
      false,
      'Only approved quotations can be delivered.',
    );
  }
  if (!row.bidwright_revision_id || !row.calculation_hash) {
    throw new AppError(
      'QUOTE_STATE_INVALID',
      'Approved quote is missing revision or calculation hash',
      409,
      false,
      'The approved quotation is missing required audit references.',
    );
  }
}
export class PostgresQuoteRepository implements QuoteRepository {
  constructor(private readonly pool: DbPool) {}

  async createIntake(input: CreateIntakeInput): Promise<IntakeRecord> {
    if (input.dograhWorkflowRunId) {
      const existing = await this.pool.query(
        `select i.*,c.name customer_name,c.phone customer_phone,c.email customer_email
         from bridge_intakes i
         left join bridge_customers c on c.id=i.customer_id and c.tenant_id=i.tenant_id
         where i.tenant_id=$1 and i.dograh_workflow_run_id=$2 limit 1`,
        [input.tenantId, input.dograhWorkflowRunId],
      );
      if (existing.rows[0]) return mapIntake(existing.rows[0]);
    }

    const customerId = randomUUID();
    const customer = await this.pool.query(
      `insert into bridge_customers(id,tenant_id,name,phone,email)
       values($1,$2,$3,$4,$5) returning id`,
      [
        customerId,
        input.tenantId,
        input.customer.name,
        input.customer.phone ?? null,
        input.customer.email ?? null,
      ],
    );

    const result = await this.pool.query(
      `insert into bridge_intakes
        (tenant_id,customer_id,source_channel,dograh_workflow_id,dograh_workflow_run_id,
         service_intent,requirements_json,location_json,notes)
       values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
       returning *,
         $10::text as customer_name,
         $11::text as customer_phone,
         $12::text as customer_email`,
      [
        input.tenantId,
        customer.rows[0].id,
        input.sourceChannel,
        input.dograhWorkflowId ?? null,
        input.dograhWorkflowRunId ?? null,
        input.serviceIntent ?? null,
        JSON.stringify(input.requirements ?? {}),
        JSON.stringify(input.location ?? {}),
        input.notes ?? null,
        input.customer.name,
        input.customer.phone ?? null,
        input.customer.email ?? null,
      ],
    );
    return mapIntake(result.rows[0]);
  }

  async getIntake(tenantId: string, intakeId: string): Promise<IntakeRecord | null> {
    const result = await this.pool.query(
      `select i.*,c.name customer_name,c.phone customer_phone,c.email customer_email
       from bridge_intakes i
       left join bridge_customers c on c.id=i.customer_id and c.tenant_id=i.tenant_id
       where i.tenant_id=$1 and i.id=$2 limit 1`,
      [tenantId, intakeId],
    );
    return result.rows[0] ? mapIntake(result.rows[0]) : null;
  }

  async createQuoteShell(input: {
    tenantId: string;
    intakeId: string;
    title: string;
    scope: string;
    providerCorrelation: string;
  }): Promise<QuoteRecord> {
    const result = await this.pool.query(
      `insert into bridge_quotes
        (tenant_id,intake_id,title,scope,provider_correlation,status,currency,validation_json)
       values($1,$2,$3,$4,$5,'estimating','MYR','{}'::jsonb)
       returning *`,
      [input.tenantId, input.intakeId, input.title, input.scope, input.providerCorrelation],
    );
    return mapQuote(result.rows[0]);
  }

  async getQuote(tenantId: string, quoteId: string): Promise<QuoteRecord | null> {
    const result = await this.pool.query(
      'select * from bridge_quotes where tenant_id=$1 and id=$2 limit 1',
      [tenantId, quoteId],
    );
    return result.rows[0] ? mapQuote(result.rows[0]) : null;
  }

  async updateQuote(
    tenantId: string,
    quoteId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const mapping: Record<string, string> = {
      quoteNumber: 'quote_number',
      title: 'title',
      scope: 'scope',
      providerCorrelation: 'provider_correlation',
      bidwrightProjectId: 'bidwright_project_id',
      bidwrightQuoteId: 'bidwright_quote_id',
      bidwrightRevisionId: 'bidwright_revision_id',
      bidwrightWorksheetId: 'bidwright_worksheet_id',
      bidwrightRateScheduleSnapshotId: 'bidwright_rate_schedule_snapshot_id',
      status: 'status',
      currency: 'currency',
      subtotal: 'subtotal',
      markup: 'markup',
      tax: 'tax',
      grandTotal: 'grand_total',
      calculationHash: 'calculation_hash',
      validation: 'validation_json',
    };

    const entries = Object.entries(patch).filter(
      ([key, value]) => mapping[key] && value !== undefined,
    );
    if (!entries.length) return;
    const sets: string[] = [];
    const values: unknown[] = [tenantId, quoteId];
    entries.forEach(([key, value], index) => {
      const dbKey = mapping[key]!;
      const position = index + 3;
      if (key === 'validation') {
        sets.push(`${dbKey}=$${position}::jsonb`);
        values.push(JSON.stringify(value));
      } else {
        sets.push(`${dbKey}=$${position}`);
        values.push(value);
      }
    });
    await this.pool.query(
      `update bridge_quotes set ${sets.join(',')},updated_at=now()
       where tenant_id=$1 and id=$2`,
      values,
    );
  }

  async hasQuoteItem(
    tenantId: string,
    quoteId: string,
    offeringRef: string,
    uom: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from bridge_quote_items
       where tenant_id=$1 and quote_id=$2 and offering_ref=$3 and uom=$4 limit 1`,
      [tenantId, quoteId, offeringRef, uom],
    );
    return Boolean(result.rows[0]);
  }

  async addQuoteItem(input: {
    tenantId: string;
    quoteId: string;
    offeringRef: string;
    itemType: 'product' | 'service';
    bidwrightItemId: string | null;
    bidwrightRateScheduleItemId: string | null;
    description: string;
    quantity: number;
    uom: string;
    unitPrice: number | null;
    extendedPrice: number | null;
  }): Promise<void> {
    await this.pool.query(
      `insert into bridge_quote_items
        (tenant_id,quote_id,offering_ref,item_type,bidwright_item_id,
         bidwright_rate_schedule_item_id,description,quantity,uom,unit_price,
         extended_price,source)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'bidwright')
       on conflict (tenant_id,quote_id,offering_ref,uom)
       where offering_ref is not null
       do update set
         bidwright_item_id=excluded.bidwright_item_id,
         bidwright_rate_schedule_item_id=excluded.bidwright_rate_schedule_item_id,
         description=excluded.description,
         quantity=excluded.quantity,
         unit_price=excluded.unit_price,
         extended_price=excluded.extended_price,
         updated_at=now()`,
      [
        input.tenantId,
        input.quoteId,
        input.offeringRef,
        input.itemType,
        input.bidwrightItemId,
        input.bidwrightRateScheduleItemId,
        input.description,
        input.quantity,
        input.uom,
        input.unitPrice,
        input.extendedPrice,
      ],
    );
  }

  async approveQuote(input: {
    tenantId: string;
    quoteId: string;
    actorId: string;
    note?: string | null;
  }): Promise<QuoteDecisionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const quoteResult = await client.query(
        'select * from bridge_quotes where tenant_id=$1 and id=$2 for update',
        [input.tenantId, input.quoteId],
      );
      const quote = quoteResult.rows[0];
      requirePendingApproval(quote);

      const approval = await client.query(
        `insert into bridge_approvals
          (tenant_id,quote_id,bidwright_revision_id,status,requested_by,approved_by,
           calculation_hash,approved_at,change_request)
         values($1,$2,$3,'approved',$4,$4,$5,now(),$6)
         returning id,quote_id,status,bidwright_revision_id,calculation_hash`,
        [
          input.tenantId,
          input.quoteId,
          quote.bidwright_revision_id,
          input.actorId,
          quote.calculation_hash,
          input.note ?? null,
        ],
      );
      await client.query(
        `update bridge_quotes
            set status='approved',approval_status='approved',updated_at=now()
          where tenant_id=$1 and id=$2`,
        [input.tenantId, input.quoteId],
      );
      await client.query(
        `insert into bridge_audit_log
          (tenant_id,actor_type,actor_id,action,resource_type,resource_id,metadata_json)
         values($1,'human',$2,'quote.approved','quote',$3,$4::jsonb)`,
        [
          input.tenantId,
          input.actorId,
          input.quoteId,
          JSON.stringify({
            bidwright_revision_id: quote.bidwright_revision_id,
            calculation_hash: quote.calculation_hash,
            grand_total: quote.grand_total,
            note: input.note ?? null,
          }),
        ],
      );
      await client.query('commit');
      const row = approval.rows[0];
      return {
        id: row.id,
        quoteId: row.quote_id,
        status: row.status,
        bidwrightRevisionId: row.bidwright_revision_id,
        calculationHash: row.calculation_hash,
      };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectQuote(input: {
    tenantId: string;
    quoteId: string;
    actorId: string;
    reason: string;
  }): Promise<QuoteDecisionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const quoteResult = await client.query(
        'select * from bridge_quotes where tenant_id=$1 and id=$2 for update',
        [input.tenantId, input.quoteId],
      );
      const quote = quoteResult.rows[0];
      requirePendingApproval(quote);
      const approval = await client.query(
        `insert into bridge_approvals
          (tenant_id,quote_id,bidwright_revision_id,status,requested_by,rejected_by,
           calculation_hash,rejected_at,change_request)
         values($1,$2,$3,'rejected',$4,$4,$5,now(),$6)
         returning id,quote_id,status,bidwright_revision_id,calculation_hash`,
        [input.tenantId, input.quoteId, quote.bidwright_revision_id, input.actorId, quote.calculation_hash, input.reason],
      );
      await client.query(
        `update bridge_quotes
            set status='rejected',approval_status='rejected',updated_at=now()
          where tenant_id=$1 and id=$2`,
        [input.tenantId, input.quoteId],
      );
      await client.query(
        `insert into bridge_audit_log
          (tenant_id,actor_type,actor_id,action,resource_type,resource_id,metadata_json)
         values($1,'human',$2,'quote.rejected','quote',$3,$4::jsonb)`,
        [input.tenantId, input.actorId, input.quoteId, JSON.stringify({ reason: input.reason })],
      );
      await client.query('commit');
      const row = approval.rows[0];
      return { id: row.id, quoteId: row.quote_id, status: row.status, bidwrightRevisionId: row.bidwright_revision_id, calculationHash: row.calculation_hash };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async requestQuoteChanges(input: {
    tenantId: string;
    quoteId: string;
    actorId: string;
    changeRequest: string;
  }): Promise<QuoteDecisionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const quoteResult = await client.query(
        'select * from bridge_quotes where tenant_id=$1 and id=$2 for update',
        [input.tenantId, input.quoteId],
      );
      const quote = quoteResult.rows[0];
      requirePendingApproval(quote);
      const approval = await client.query(
        `insert into bridge_approvals
          (tenant_id,quote_id,bidwright_revision_id,status,requested_by,calculation_hash,change_request)
         values($1,$2,$3,'changes_requested',$4,$5,$6)
         returning id,quote_id,status,bidwright_revision_id,calculation_hash`,
        [input.tenantId, input.quoteId, quote.bidwright_revision_id, input.actorId, quote.calculation_hash, input.changeRequest],
      );
      await client.query(
        `update bridge_quotes
            set status='changes_requested',approval_status='changes_requested',updated_at=now()
          where tenant_id=$1 and id=$2`,
        [input.tenantId, input.quoteId],
      );
      await client.query(
        `insert into bridge_audit_log
          (tenant_id,actor_type,actor_id,action,resource_type,resource_id,metadata_json)
         values($1,'human',$2,'quote.changes_requested','quote',$3,$4::jsonb)`,
        [input.tenantId, input.actorId, input.quoteId, JSON.stringify({ change_request: input.changeRequest })],
      );
      await client.query('commit');
      const row = approval.rows[0];
      return { id: row.id, quoteId: row.quote_id, status: row.status, bidwrightRevisionId: row.bidwright_revision_id, calculationHash: row.calculation_hash };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordDelivery(input: {
    tenantId: string;
    quoteId: string;
    actorId: string;
    channel: string;
    recipient: string;
    pdfSha256: string;
  }): Promise<QuoteDeliveryRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const quoteResult = await client.query(
        'select * from bridge_quotes where tenant_id=$1 and id=$2 for update',
        [input.tenantId, input.quoteId],
      );
      const quote = quoteResult.rows[0];
      requireApproved(quote);
      const approval = await client.query(
        `select 1 from bridge_approvals
          where tenant_id=$1 and quote_id=$2 and bidwright_revision_id=$3
            and calculation_hash=$4 and status='approved'
          limit 1`,
        [input.tenantId, input.quoteId, quote.bidwright_revision_id, quote.calculation_hash],
      );
      if (!approval.rows[0]) {
        throw new AppError(
          'QUOTE_APPROVAL_MISMATCH',
          'Approved audit record does not match quote revision and calculation hash',
          409,
          false,
          'The quotation approval could not be verified.',
        );
      }
      const delivery = await client.query(
        `insert into bridge_deliveries
          (tenant_id,quote_id,bidwright_revision_id,channel,recipient,pdf_sha256,status,attempt_count,sent_at)
         values($1,$2,$3,$4,$5,$6,'sent',1,now())
         on conflict (tenant_id,quote_id,bidwright_revision_id,channel,recipient,coalesce(pdf_sha256,''))
         do update set status='sent',attempt_count=bridge_deliveries.attempt_count+1,sent_at=now(),updated_at=now()
         returning id,quote_id,bidwright_revision_id,channel,recipient,pdf_sha256,status`,
        [input.tenantId, input.quoteId, quote.bidwright_revision_id, input.channel, input.recipient, input.pdfSha256],
      );
      await client.query(
        `update bridge_quotes
            set status='sent',approval_status='approved',updated_at=now()
          where tenant_id=$1 and id=$2`,
        [input.tenantId, input.quoteId],
      );
      await client.query(
        `insert into bridge_audit_log
          (tenant_id,actor_type,actor_id,action,resource_type,resource_id,metadata_json)
         values($1,'human',$2,'quote.delivered','quote',$3,$4::jsonb)`,
        [
          input.tenantId,
          input.actorId,
          input.quoteId,
          JSON.stringify({ channel: input.channel, recipient: input.recipient, pdf_sha256: input.pdfSha256 }),
        ],
      );
      await client.query('commit');
      const row = delivery.rows[0];
      return { id: row.id, quoteId: row.quote_id, bidwrightRevisionId: row.bidwright_revision_id, channel: row.channel, recipient: row.recipient, pdfSha256: row.pdf_sha256, status: row.status };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export class InMemoryQuoteRepository implements QuoteRepository {
  readonly intakes: IntakeRecord[] = [];
  readonly quotes: QuoteRecord[] = [];
  readonly items: any[] = [];

  async createIntake(input: CreateIntakeInput): Promise<IntakeRecord> {
    const record: IntakeRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      customerId: randomUUID(),
      customerName: input.customer.name,
      customerPhone: input.customer.phone ?? null,
      customerEmail: input.customer.email ?? null,
      sourceChannel: input.sourceChannel,
      serviceIntent: input.serviceIntent ?? null,
      requirements: structuredClone(input.requirements ?? {}),
      location: structuredClone(input.location ?? {}),
      notes: input.notes ?? null,
    };
    this.intakes.push(record);
    return structuredClone(record);
  }

  async getIntake(tenantId: string, intakeId: string): Promise<IntakeRecord | null> {
    const value = this.intakes.find((x) => x.tenantId === tenantId && x.id === intakeId);
    return value ? structuredClone(value) : null;
  }

  async createQuoteShell(input: {
    tenantId: string;
    intakeId: string;
    title: string;
    scope: string;
    providerCorrelation: string;
  }): Promise<QuoteRecord> {
    const record: QuoteRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      intakeId: input.intakeId,
      quoteNumber: null,
      title: input.title,
      scope: input.scope,
      providerCorrelation: input.providerCorrelation,
      bidwrightProjectId: null,
      bidwrightQuoteId: null,
      bidwrightRevisionId: null,
      bidwrightWorksheetId: null,
      bidwrightRateScheduleSnapshotId: null,
      status: 'estimating',
      currency: 'MYR',
      subtotal: null,
      markup: null,
      tax: null,
      grandTotal: null,
      calculationHash: null,
      validation: {},
    };
    this.quotes.push(record);
    return structuredClone(record);
  }

  async getQuote(tenantId: string, quoteId: string): Promise<QuoteRecord | null> {
    const value = this.quotes.find((x) => x.tenantId === tenantId && x.id === quoteId);
    return value ? structuredClone(value) : null;
  }

  async updateQuote(tenantId: string, quoteId: string, patch: any): Promise<void> {
    const value = this.quotes.find((x) => x.tenantId === tenantId && x.id === quoteId);
    if (!value) throw new Error('QUOTE_NOT_FOUND');
    Object.assign(value, structuredClone(patch));
  }

  async hasQuoteItem(
    tenantId: string,
    quoteId: string,
    offeringRef: string,
    uom: string,
  ): Promise<boolean> {
    return this.items.some(
      (x) =>
        x.tenantId === tenantId &&
        x.quoteId === quoteId &&
        x.offeringRef === offeringRef &&
        x.uom === uom,
    );
  }

  async addQuoteItem(input: any): Promise<void> {
    this.items.push(structuredClone(input));
  }

  async approveQuote(input: { tenantId: string; quoteId: string; actorId: string; note?: string | null }): Promise<QuoteDecisionRecord> {
    const quote = this.quotes.find((x) => x.tenantId === input.tenantId && x.id === input.quoteId);
    requirePendingApproval({
      ...quote,
      bidwright_revision_id: quote?.bidwrightRevisionId,
      calculation_hash: quote?.calculationHash,
      grand_total: quote?.grandTotal,
    });
    quote!.status = 'approved';
    return { id: randomUUID(), quoteId: input.quoteId, status: 'approved', bidwrightRevisionId: quote!.bidwrightRevisionId!, calculationHash: quote!.calculationHash };
  }

  async rejectQuote(input: { tenantId: string; quoteId: string; actorId: string; reason: string }): Promise<QuoteDecisionRecord> {
    const quote = this.quotes.find((x) => x.tenantId === input.tenantId && x.id === input.quoteId);
    requirePendingApproval({
      ...quote,
      bidwright_revision_id: quote?.bidwrightRevisionId,
      calculation_hash: quote?.calculationHash,
      grand_total: quote?.grandTotal,
    });
    quote!.status = 'rejected';
    return { id: randomUUID(), quoteId: input.quoteId, status: 'rejected', bidwrightRevisionId: quote!.bidwrightRevisionId!, calculationHash: quote!.calculationHash };
  }

  async requestQuoteChanges(input: { tenantId: string; quoteId: string; actorId: string; changeRequest: string }): Promise<QuoteDecisionRecord> {
    const quote = this.quotes.find((x) => x.tenantId === input.tenantId && x.id === input.quoteId);
    requirePendingApproval({
      ...quote,
      bidwright_revision_id: quote?.bidwrightRevisionId,
      calculation_hash: quote?.calculationHash,
      grand_total: quote?.grandTotal,
    });
    quote!.status = 'changes_requested';
    return { id: randomUUID(), quoteId: input.quoteId, status: 'changes_requested', bidwrightRevisionId: quote!.bidwrightRevisionId!, calculationHash: quote!.calculationHash };
  }

  async recordDelivery(input: { tenantId: string; quoteId: string; actorId: string; channel: string; recipient: string; pdfSha256: string }): Promise<QuoteDeliveryRecord> {
    const quote = this.quotes.find((x) => x.tenantId === input.tenantId && x.id === input.quoteId);
    requireApproved({
      ...quote,
      bidwright_revision_id: quote?.bidwrightRevisionId,
      calculation_hash: quote?.calculationHash,
    });
    quote!.status = 'sent';
    return { id: randomUUID(), quoteId: input.quoteId, bidwrightRevisionId: quote!.bidwrightRevisionId!, channel: input.channel, recipient: input.recipient, pdfSha256: input.pdfSha256, status: 'sent' };
  }
}
