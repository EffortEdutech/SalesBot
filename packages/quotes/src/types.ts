export type BridgeQuoteState =
  | 'captured'
  | 'estimating'
  | 'needs_review'
  | 'draft'
  | 'pending_approval'
  | 'changes_requested'
  | 'rejected'
  | 'approved'
  | 'delivery_pending'
  | 'sent'
  | 'delivery_failed'
  | 'cancelled'
  | 'expired'
  | 'upstream_unknown';

export interface IntakeRecord {
  id: string;
  tenantId: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  sourceChannel: string;
  serviceIntent: string | null;
  requirements: Record<string, unknown>;
  location: Record<string, unknown>;
  notes: string | null;
}

export interface QuoteRecord {
  id: string;
  tenantId: string;
  intakeId: string | null;
  quoteNumber: string | null;
  title: string | null;
  scope: string | null;
  providerCorrelation: string | null;
  bidwrightProjectId: string | null;
  bidwrightQuoteId: string | null;
  bidwrightRevisionId: string | null;
  bidwrightWorksheetId: string | null;
  bidwrightRateScheduleSnapshotId: string | null;
  status: BridgeQuoteState;
  currency: string;
  subtotal: number | null;
  markup: number | null;
  tax: number | null;
  grandTotal: number | null;
  calculationHash: string | null;
  validation: {
    requirements_complete?: boolean;
    pricing_complete?: boolean;
    calculation_valid?: boolean;
    blocking_reasons?: string[];
    warnings?: string[];
  };
}

export interface PrepareQuoteInput {
  intake_id: string;
  title: string;
  scope: string;
  line_proposals: Array<{
    offering_ref: string;
    quantity: number;
    uom: string;
  }>;
}

export interface PrepareQuoteResult {
  ok: true;
  quote_id: string;
  quote_number?: string;
  state: 'pending_approval' | 'needs_review';
  currency?: string;
  subtotal?: number;
  grand_total?: number;
  validation: {
    requirements_complete: boolean;
    pricing_complete: boolean;
    calculation_valid: boolean;
    blocking_reasons: string[];
    warnings: string[];
  };
  user_safe_message: string;
}
