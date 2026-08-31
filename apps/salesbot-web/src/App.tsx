import { useEffect, useMemo, useState } from 'react';
import {
  BridgeClient,
  type Connection,
  type IntakeRow,
  type Offering,
  type OperationRow,
  type Overview,
  type QuoteRow,
  type QuoteDetail,
  type PdfDownload,
  type SystemDiagnostics,
} from './api';

type Page = 'overview' | 'intakes' | 'builder' | 'quotes' | 'prices' | 'operations' | 'connection';
const SESSION_KEY = 'salesbot.operator.connection.v1';

function money(value: number | null | undefined, currency = 'MYR') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency }).format(value);
}
function dt(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat('en-MY', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(d);
}
function pretty(s: string) {
  return s
    .split('_')
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
    .join(' ');
}
function statusKind(s: string) {
  if (['approved', 'sent', 'succeeded'].includes(s)) return 'good';
  if (['needs_review', 'upstream_unknown', 'failed_retriable'].includes(s)) return 'warn';
  if (['rejected', 'failed_terminal', 'delivery_failed'].includes(s)) return 'bad';
  return 'neutral';
}
function Badge({ value }: { value: string }) {
  return <span className={`badge badge--${statusKind(value)}`}>{pretty(value)}</span>;
}

function loadConnection(): Connection {
  const fallback = {
    baseUrl: import.meta.env.VITE_BRIDGE_BASE_URL || '/bridge',
    tenantId: import.meta.env.VITE_DEFAULT_TENANT_ID || 'tenant_hvac_pilot',
    token: '',
  };
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function ConnectionScreen({
  initial,
  onSave,
  onCancel,
}: {
  initial: Connection;
  onSave: (c: Connection) => void;
  onCancel?: () => void;
}) {
  const [c, setC] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function connect() {
    const candidate = {
      baseUrl: c.baseUrl.trim(),
      tenantId: c.tenantId.trim(),
      token: c.token.trim(),
    };
    setBusy(true);
    setErr('');
    try {
      await new BridgeClient(candidate).system();
      onSave(candidate);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect-screen">
      <div className="connect-wrap">
        <div className="connect-brand">
          <div className="logo big">SB</div>
          <div>
            <h1>SalesBot</h1>
            <p>Operator Console · Unified Development Platform</p>
          </div>
        </div>
        <div className="card form-card">
          <div>
            <h2>Connect to SalesBot</h2>
            <p>The console verifies Bridge, tenant and operator authentication before opening.</p>
          </div>
          <label>
            Bridge URL
            <input value={c.baseUrl} onChange={(e) => setC({ ...c, baseUrl: e.target.value })} />
          </label>
          <label>
            Tenant ID
            <input value={c.tenantId} onChange={(e) => setC({ ...c, tenantId: e.target.value })} />
          </label>
          <label>
            Bearer token
            <input
              type="password"
              autoComplete="off"
              value={c.token}
              onChange={(e) => setC({ ...c, token: e.target.value })}
              placeholder="brg_..."
            />
          </label>
          {err ? <div className="callout bad">{err}</div> : null}
          <div className="callout">
            Development/staging operator token only. Database credentials, Bridge pepper and
            Bidwright credentials stay server-side.
          </div>
          <div className="buttons">
            {onCancel ? (
              <button className="btn ghost" onClick={onCancel}>
                Cancel
              </button>
            ) : null}
            <button
              className="btn primary"
              disabled={busy || !c.baseUrl.trim() || !c.tenantId.trim() || !c.token.trim()}
              onClick={() => void connect()}
            >
              {busy ? 'Verifying…' : 'Verify & connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}

function OverviewPage({ client, goto }: { client: BridgeClient; goto: (p: Page) => void }) {
  const [o, setO] = useState<Overview | null>(null);
  const [q, setQ] = useState<QuoteRow[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    Promise.all([client.overview(), client.quotes()])
      .then(([a, b]) => {
        setO(a);
        setQ(b.items.slice(0, 5));
      })
      .catch((e: Error) => setErr(e.message));
  }, [client]);
  return (
    <div className="page">
      <header>
        <div>
          <h1>SalesBot overview</h1>
          <p>Live tenant state from the Bridge.</p>
        </div>
        <button className="btn primary" onClick={() => goto('builder')}>
          Build test quote
        </button>
      </header>
      {err ? <div className="callout bad">{err}</div> : null}
      <div className="metrics">
        <Metric label="New intakes" value={o?.new_intakes_24h ?? '—'} helper="Last 24h" />
        <Metric
          label="Pending approval"
          value={o?.pending_approval ?? '—'}
          helper={o ? money(o.pending_approval_value) : 'Awaiting data'}
        />
        <Metric label="Needs review" value={o?.needs_review ?? '—'} helper="Human attention" />
        <Metric label="Sent" value={o?.sent_24h ?? '—'} helper="Last 24h" />
      </div>
      {o?.upstream_unknown ? (
        <div className="callout warn">
          {o.upstream_unknown} operation(s) require upstream reconciliation.
        </div>
      ) : null}
      <section>
        <div className="section-title">
          <div>
            <h2>Recent quotes</h2>
            <p>Bridge state with exact Bidwright revision references.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Status</th>
                <th>Rev</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {q.length ? (
                q.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <b>{x.customer_name || 'Unknown'}</b>
                      <small>{x.id}</small>
                    </td>
                    <td>
                      <Badge value={x.status} />
                    </td>
                    <td>{x.revision_number}</td>
                    <td>{money(x.grand_total, x.currency)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="empty">
                    No quotes yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function IntakesPage({ client }: { client: BridgeClient }) {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    client
      .intakes()
      .then((r) => setRows(r.items))
      .catch((e: Error) => setErr(e.message));
  }, [client]);
  return (
    <div className="page">
      <header>
        <div>
          <h1>Leads / Intakes</h1>
          <p>Structured customer requirements captured by staff, web or Dograh.</p>
        </div>
      </header>
      {err ? <div className="callout bad">{err}</div> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Intent</th>
              <th>Source</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.customer_name || 'Unknown'}</b>
                    <small>{x.phone || x.id}</small>
                  </td>
                  <td>{x.service_intent || '—'}</td>
                  <td>{x.source_channel}</td>
                  <td>
                    <Badge value={x.status} />
                  </td>
                  <td>{dt(x.created_at)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="empty">
                  No intakes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QuotesPage({ client }: { client: BridgeClient }) {
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [pdf, setPdf] = useState<PdfDownload | null>(null);
  const [note, setNote] = useState('Reviewed customer, scope, revision, total, validation and commercial hash.');
  const [reason, setReason] = useState('');
  const [recipient, setRecipient] = useState('uat-local-operator');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState('');

  async function refresh(selectId = selectedId) {
    setErr('');
    const list = await client.quotes();
    setRows(list.items);
    const id = selectId || list.items[0]?.id || '';
    setSelectedId(id);
    if (id) setDetail(await client.quoteDetail(id));
  }

  useEffect(() => {
    refresh().catch((e: Error) => setErr(e.message));
  }, [client]);

  async function select(id: string) {
    setBusy('detail');
    setErr('');
    setOk('');
    setPdf(null);
    try {
      setSelectedId(id);
      setDetail(await client.quoteDetail(id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Quote detail failed');
    } finally {
      setBusy('');
    }
  }

  async function decide(action: 'approve' | 'reject' | 'changes') {
    if (!detail) return;
    setBusy(action);
    setErr('');
    setOk('');
    try {
      const id = detail.quote.id;
      const result =
        action === 'approve'
          ? await client.approveQuote(id, note)
          : action === 'reject'
            ? await client.rejectQuote(id, reason || 'Rejected by operator after review.')
            : await client.requestQuoteChanges(id, reason || 'Changes requested by operator after review.');
      setOk(`${pretty(String(result.state || action))} recorded for ${detail.quote.quote_number || id}.`);
      await refresh(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Decision failed');
    } finally {
      setBusy('');
    }
  }

  async function downloadPdf() {
    if (!detail) return;
    setBusy('pdf');
    setErr('');
    setOk('');
    try {
      const file = await client.downloadQuotePdf(detail.quote.id, detail.quote.quote_number);
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
      setPdf(file);
      setOk(`Downloaded approved PDF. SHA-256 ${file.sha256}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'PDF download failed');
    } finally {
      setBusy('');
    }
  }

  async function deliverDownloaded() {
    if (!detail || !pdf) return;
    setBusy('deliver');
    setErr('');
    setOk('');
    try {
      const result = await client.deliverQuote({
        quote_id: detail.quote.id,
        channel: 'download',
        recipient,
        pdf_sha256: pdf.sha256,
      });
      setOk(`Download delivery recorded. Delivery ${result.delivery_id}; hash ${result.pdf_sha256}.`);
      await refresh(detail.quote.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delivery failed');
    } finally {
      setBusy('');
    }
  }

  const q = detail?.quote;
  const canDecide = q?.status === 'pending_approval';
  const canPdf = q && ['approved', 'sent'].includes(q.status);
  const warnings = q?.validation?.warnings || [];
  const blockers = q?.validation?.blocking_reasons || [];

  return (
    <div className="page">
      <header>
        <div>
          <h1>Quote approvals & delivery</h1>
          <p>Human-controlled review, approval decision, approved PDF export and download delivery.</p>
        </div>
        <button className="btn ghost" onClick={() => void refresh()} disabled={Boolean(busy)}>
          Refresh
        </button>
      </header>
      {err ? <div className="callout bad">{err}</div> : null}
      {ok ? <div className="callout good">{ok}</div> : null}
      <div className="cols">
        <div className="card form-card">
          <h2>Quote queue</h2>
          <div className="candidate-list">
            {rows.length ? (
              rows.map((x) => (
                <button
                  className={`candidate ${selectedId === x.id ? 'selected' : ''}`}
                  key={x.id}
                  onClick={() => void select(x.id)}
                >
                  <span>
                    <b>{x.customer_name || 'Unknown'} � {money(x.grand_total, x.currency)}</b>
                    <small>{x.id} � Rev {x.revision_number}</small>
                  </span>
                  <Badge value={x.status} />
                </button>
              ))
            ) : (
              <div className="empty-panel">No quotes yet.</div>
            )}
          </div>
        </div>

        <div className="card form-card">
          <h2>Human decision controls</h2>
          {q ? (
            <>
              <div className="summary">
                <Badge value={q.status} />
                <b>{money(q.grand_total, q.currency)}</b>
              </div>
              <label>
                Approval note / decision reason
                <textarea value={canDecide ? note : reason} onChange={(e) => (canDecide ? setNote(e.target.value) : setReason(e.target.value))} />
              </label>
              <div className="buttons">
                <button className="btn primary" disabled={!canDecide || busy === 'approve'} onClick={() => void decide('approve')}>
                  Approve
                </button>
                <button className="btn ghost" disabled={!canDecide || busy === 'changes'} onClick={() => void decide('changes')}>
                  Request changes
                </button>
                <button className="btn ghost" disabled={!canDecide || busy === 'reject'} onClick={() => void decide('reject')}>
                  Reject
                </button>
              </div>
              <hr />
              <label>
                Download/manual recipient reference
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} />
              </label>
              <div className="buttons">
                <button className="btn primary" disabled={!canPdf || busy === 'pdf'} onClick={() => void downloadPdf()}>
                  Download approved PDF
                </button>
                <button className="btn ghost" disabled={!pdf || q.status !== 'approved' || busy === 'deliver'} onClick={() => void deliverDownloaded()}>
                  Record download delivery
                </button>
              </div>
              {pdf ? <small>Last downloaded PDF hash: {pdf.sha256}</small> : null}
            </>
          ) : (
            <div className="empty-panel">Select a quote to review.</div>
          )}
        </div>
      </div>

      {q ? (
        <section>
          <div className="section-title">
            <div>
              <h2>{q.quote_number || q.id}</h2>
              <p>{q.customer_name || 'Unknown customer'} � {q.scope || q.title || 'No scope recorded'}</p>
            </div>
          </div>
          <div className="metrics">
            <Metric label="Revision" value={q.revision_number} helper={q.bidwright_revision_id || 'No revision'} />
            <Metric label="Currency" value={q.currency} helper="Tenant quotation currency" />
            <Metric label="Grand total" value={money(q.grand_total, q.currency)} helper="Bidwright authoritative" />
            <Metric label="Calc hash" value={q.calculation_hash ? q.calculation_hash.slice(0, 10) : '�'} helper="Approved content fingerprint" />
          </div>
          {blockers.length || warnings.length ? (
            <div className="callout warn">
              {[...blockers, ...warnings].join('; ')}
            </div>
          ) : (
            <div className="callout good">No validation warnings or blockers recorded.</div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>UOM</th>
                  <th>Unit</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.length ? (
                  detail.items.map((x: QuoteDetail['items'][number]) => (
                    <tr key={x.id}>
                      <td><b>{x.description}</b><small>{x.offering_ref || x.bidwright_item_id || '�'}</small></td>
                      <td>{x.item_type}</td>
                      <td>{x.quantity}</td>
                      <td>{x.uom}</td>
                      <td>{money(x.unit_price, q.currency)}</td>
                      <td>{money(x.extended_price, q.currency)}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={6} className="empty">No line items recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Revision, approval, delivery and audit evidence</summary>
            <pre>{JSON.stringify({ quote: q, approvals: detail.approvals, deliveries: detail.deliveries, audit: detail.audit }, null, 2)}</pre>
          </details>
        </section>
      ) : null}
    </div>
  );
}
function OperationsPage({ client }: { client: BridgeClient }) {
  const [rows, setRows] = useState<OperationRow[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    client
      .operations()
      .then((r) => setRows(r.items))
      .catch((e: Error) => setErr(e.message));
  }, [client]);
  return (
    <div className="page">
      <header>
        <div>
          <h1>Bridge operations</h1>
          <p>Idempotency, saga checkpoints and upstream uncertainty.</p>
        </div>
      </header>
      {err ? <div className="callout bad">{err}</div> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Operation</th>
              <th>Status</th>
              <th>Step</th>
              <th>Attempt</th>
              <th>Error</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.operation_type}</b>
                    <small>{x.idempotency_key}</small>
                  </td>
                  <td>
                    <Badge value={x.status} />
                  </td>
                  <td>{x.current_step || '—'}</td>
                  <td>{x.attempt_count}</td>
                  <td>{x.last_error_code || '—'}</td>
                  <td>{dt(x.updated_at)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="empty">
                  No operations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PricesPage({ client }: { client: BridgeClient }) {
  const [query, setQuery] = useState('2HP aircond installation');
  const [rows, setRows] = useState<Offering[]>([]);
  const [resolved, setResolved] = useState<Record<string, any>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function search() {
    setBusy(true);
    setErr('');
    try {
      setRows((await client.searchOfferings(query)).items);
      setResolved({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }
  async function resolve(x: Offering) {
    setErr('');
    try {
      const r = await client.resolvePrice({
        offering_ref: x.offering_ref,
        quantity: 1,
        uom: x.uom,
      });
      setResolved((s) => ({ ...s, [x.offering_ref]: r }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Resolve failed');
    }
  }
  return (
    <div className="page">
      <header>
        <div>
          <h1>Offering / Price lookup</h1>
          <p>Search tenant-approved offerings and resolve financial truth server-side.</p>
        </div>
      </header>
      <div className="card form-card">
        <label>
          Customer wording
          <div className="inline">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
            />
            <button
              className="btn primary"
              disabled={busy || !query.trim()}
              onClick={() => void search()}
            >
              {busy ? 'Searching…' : 'Search'}
            </button>
          </div>
        </label>
      </div>
      {err ? <div className="callout bad">{err}</div> : null}
      <div className="list">
        {rows.length ? (
          rows.map((x) => (
            <div className="result" key={x.offering_ref}>
              <div>
                <b>{x.name}</b>
                <small>
                  {x.code} · {x.type} · {x.uom} · {(x.match_confidence * 100).toFixed(0)}%
                </small>
              </div>
              <div className="result-actions">
                <span>
                  {resolved[x.offering_ref]?.price_disclosure === 'allowed' &&
                  typeof resolved[x.offering_ref]?.unit_price === 'number'
                    ? money(
                        resolved[x.offering_ref].unit_price,
                        resolved[x.offering_ref].currency || 'MYR',
                      )
                    : resolved[x.offering_ref]
                      ? `Policy: ${resolved[x.offering_ref].price_disclosure || x.price_disclosure}`
                      : ''}
                </span>
                <button className="btn ghost" onClick={() => void resolve(x)}>
                  Resolve
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-panel">Run a search to inspect the tenant catalogue.</div>
        )}
      </div>
    </div>
  );
}

function BuilderPage({ client }: { client: BridgeClient }) {
  const [customer, setCustomer] = useState('Ahmad');
  const [phone, setPhone] = useState('+60123456789');
  const [location, setLocation] = useState('Ipoh');
  const [building, setBuilding] = useState('office');
  const [capacity, setCapacity] = useState('2.0HP');
  const [qty, setQty] = useState(3);
  const [intakeId, setIntakeId] = useState('');
  const [query, setQuery] = useState('2HP aircond');
  const [offers, setOffers] = useState<Offering[]>([]);
  const [lines, setLines] = useState<
    Array<{
      offering_ref: string;
      quantity: number;
      uom: string;
      name: string;
      display?: number | null;
    }>
  >([]);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const scope = `Supply and install ${qty} x ${capacity} AC unit${qty === 1 ? '' : 's'} at ${building} in ${location}.`;
  async function intake() {
    setBusy('intake');
    setErr('');
    try {
      const r = await client.createIntake({
        caller_name: customer,
        phone,
        service: 'air_conditioning_installation',
        location,
        requirements: { capacity, unit_type: capacity, quantity: qty, building_type: building },
        notes: 'Created from SalesBot operator console.',
        source: 'staff',
      });
      const id = String(r.intake_id || r.id || '');
      if (!id) throw new Error('Bridge did not return intake ID');
      setIntakeId(id);
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Intake failed');
    } finally {
      setBusy('');
    }
  }
  async function search() {
    setBusy('search');
    setErr('');
    try {
      setOffers((await client.searchOfferings(query)).items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy('');
    }
  }
  async function add(x: Offering) {
    setErr('');
    try {
      const r = await client.resolvePrice({
        offering_ref: x.offering_ref,
        quantity: qty,
        uom: x.uom,
      });
      setLines((s) => [
        ...s.filter((y) => y.offering_ref !== x.offering_ref),
        {
          offering_ref: x.offering_ref,
          quantity: qty,
          uom: x.uom,
          name: x.name,
          display: typeof r.line_total === 'number' ? r.line_total : null,
        },
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Price resolve failed');
    }
  }
  async function prepare() {
    if (!intakeId) return setErr('Capture intake first.');
    if (!lines.length) return setErr('Add at least one offering.');
    setBusy('prepare');
    setErr('');
    try {
      // Critical invariant: authoritative money is deliberately NOT present.
      const payload = {
        intake_id: intakeId,
        title: `${customer} - AC Installation`,
        scope,
        line_proposals: lines.map(({ offering_ref, quantity, uom }) => ({
          offering_ref,
          quantity,
          uom,
        })),
      };
      setResult(await client.prepareQuote(payload));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Prepare failed');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="page">
      <header>
        <div>
          <h1>Deterministic quote builder</h1>
          <p>Manual operator path through the same Bridge contract Dograh will use.</p>
        </div>
      </header>
      {err ? <div className="callout bad">{err}</div> : null}
      <div className="cols">
        <div className="card form-card">
          <h2>1. Customer intake</h2>
          <div className="form-grid">
            <label>
              Customer
              <input value={customer} onChange={(e) => setCustomer(e.target.value)} />
            </label>
            <label>
              Phone
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label>
              Location
              <input value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label>
              Building
              <input value={building} onChange={(e) => setBuilding(e.target.value)} />
            </label>
            <label>
              Capacity
              <input value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </label>
            <label>
              Quantity
              <input
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
          </div>
          <div className="scope">
            <small>Scope</small>
            {scope}
          </div>
          <button
            className="btn primary"
            onClick={() => void intake()}
            disabled={busy === 'intake'}
          >
            {busy === 'intake' ? 'Capturing…' : 'Capture intake'}
          </button>
          {intakeId ? (
            <div className="success">
              Intake: <code>{intakeId}</code>
            </div>
          ) : null}
        </div>
        <div className="card form-card">
          <h2>2. Approved offerings</h2>
          <label>
            Search
            <div className="inline">
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
              <button className="btn ghost" onClick={() => void search()}>
                Search
              </button>
            </div>
          </label>
          <div className="candidate-list">
            {offers.length ? (
              offers.map((x) => (
                <button className="candidate" key={x.offering_ref} onClick={() => void add(x)}>
                  <span>
                    <b>{x.name}</b>
                    <small>
                      {x.code} · {x.uom} · {x.type}
                    </small>
                  </span>
                  <span>+ Add</span>
                </button>
              ))
            ) : (
              <div className="empty-panel">Search product and installation offerings.</div>
            )}
          </div>
        </div>
      </div>
      <section>
        <div className="section-title">
          <div>
            <h2>3. Quote proposals</h2>
            <p>Only offering_ref + quantity + UOM go to quote.prepare.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Offering</th>
                <th>Qty</th>
                <th>UOM</th>
                <th>Display resolved total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.length ? (
                lines.map((x) => (
                  <tr key={x.offering_ref}>
                    <td>
                      <b>{x.name}</b>
                      <small>{x.offering_ref}</small>
                    </td>
                    <td>{x.quantity}</td>
                    <td>{x.uom}</td>
                    <td>{money(x.display)}</td>
                    <td>
                      <button
                        className="link"
                        onClick={() =>
                          setLines((s) => s.filter((y) => y.offering_ref !== x.offering_ref))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="empty">
                    No line proposals.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="buttons end">
          <button
            className="btn primary"
            disabled={!intakeId || !lines.length || busy === 'prepare'}
            onClick={() => void prepare()}
          >
            {busy === 'prepare' ? 'Preparing…' : 'Prepare deterministic quote'}
          </button>
        </div>
      </section>
      {result ? (
        <div className="card result-card">
          <div>
            <small>Bridge result</small>
            <h2>{String(result.quote_id || result.id || 'Operation completed')}</h2>
          </div>
          <div className="summary">
            {result.state || result.status ? (
              <Badge value={String(result.state || result.status)} />
            ) : null}
            {typeof result.grand_total === 'number' ? (
              <b>{money(result.grand_total, String(result.currency || 'MYR'))}</b>
            ) : null}
          </div>
          <details>
            <summary>Technical response</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function systemKind(status: string) {
  if (['connected', 'ready', 'active', 'authenticated', 'reachable', 'configured'].includes(status))
    return 'good';
  if (
    ['missing', 'not_configured', 'incomplete', 'unreachable', 'disabled', 'error'].includes(status)
  )
    return 'warn';
  return 'neutral';
}

function SystemCard({
  title,
  status,
  detail,
  helper,
}: {
  title: string;
  status: string;
  detail: string;
  helper?: string | undefined;
}) {
  return (
    <div className="card system-card">
      <div className="system-card-head">
        <h2>{title}</h2>
        <span className={`status-dot status-dot--${systemKind(status)}`}></span>
      </div>
      <strong>{pretty(status)}</strong>
      <p>{detail}</p>
      {helper ? <small>{helper}</small> : null}
    </div>
  );
}

function ConnectionPage({
  client,
  connection,
  onChange,
}: {
  client: BridgeClient;
  connection: Connection;
  onChange: () => void;
}) {
  const [system, setSystem] = useState<SystemDiagnostics | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setErr('');
    try {
      setSystem(await client.system());
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Diagnostics failed.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [client]);

  return (
    <div className="page">
      <header>
        <div>
          <h1>System & connection</h1>
          <p>One-screen development diagnostics. Secrets remain on the Bridge.</p>
        </div>
        <div className="buttons">
          <button className="btn ghost" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Checking…' : 'Refresh'}
          </button>
          <button className="btn primary" onClick={onChange}>
            Change session
          </button>
        </div>
      </header>

      {err ? <div className="callout bad">{err}</div> : null}

      <div className="system-grid">
        <SystemCard
          title="Bridge API"
          status={system?.bridge.status || 'checking'}
          detail={
            system ? `Port ${system.bridge.port} · ${system.bridge.app_env}` : connection.baseUrl
          }
        />
        <SystemCard
          title="SalesBot DB"
          status={system?.database.status || 'checking'}
          detail={system ? 'PostgreSQL reachable through Bridge' : 'Checking database'}
        />
        <SystemCard
          title="Migrations"
          status={system?.migrations.status || 'checking'}
          detail={
            system
              ? `${system.migrations.present_tables}/${system.migrations.expected_tables} required tables present`
              : 'Checking schema'
          }
          helper={
            system?.migrations.missing_columns.length
              ? `Missing: ${system.migrations.missing_columns.join(', ')}`
              : undefined
          }
        />
        <SystemCard
          title="Tenant"
          status={system?.tenant.status || 'checking'}
          detail={
            system
              ? `${system.tenant.name} · ${system.tenant.currency} · ${system.tenant.timezone}`
              : connection.tenantId
          }
        />
        <SystemCard
          title="Operator"
          status={system?.operator.status || 'checking'}
          detail={
            system
              ? `${system.operator.name} · ${pretty(system.operator.role)}`
              : 'Checking operator identity'
          }
        />
        <SystemCard
          title="Bidwright"
          status={system?.bidwright.status || 'checking'}
          detail={system?.bidwright.base_url || 'Not configured yet'}
          helper={
            system?.bidwright.status === 'reachable'
              ? 'HTTP origin reachable; contract gate remains separate.'
              : undefined
          }
        />
        <SystemCard
          title="Price book"
          status={system?.price_book.status || 'checking'}
          detail={
            system && 'name' in system.price_book
              ? `${system.price_book.name} · ${system.price_book.currency}`
              : 'HVAC pilot price book not provisioned'
          }
        />
        <SystemCard
          title="Dograh"
          status={system?.dograh.status || 'checking'}
          detail={
            system?.dograh.status === 'configured'
              ? 'Tenant connection configured'
              : 'Dograh provisioning not completed'
          }
        />
      </div>

      {system?.migrations.missing_tables.length ? (
        <div className="callout warn">
          Missing tables: {system.migrations.missing_tables.join(', ')}
        </div>
      ) : null}
      <div className="card form-card">
        <div>
          <b>Browser → Bridge</b>
          <p>{connection.baseUrl}</p>
        </div>
        <div>
          <b>Tenant assertion</b>
          <p>{connection.tenantId}</p>
        </div>
        <div className="callout">
          The browser never receives DATABASE_URL, BRIDGE_TOKEN_PEPPER or Bidwright service
          credentials.
        </div>
      </div>
    </div>
  );
}

function App() {
  const [connection, setConnection] = useState<Connection>(() => loadConnection());
  const [connect, setConnect] = useState(!connection.token);
  const [page, setPage] = useState<Page>('overview');
  const client = useMemo(() => new BridgeClient(connection), [connection]);
  function save(c: Connection) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(c));
    setConnection(c);
    setConnect(false);
  }
  if (connect)
    return (
      <ConnectionScreen
        initial={connection}
        onSave={save}
        onCancel={connection.token ? () => setConnect(false) : undefined}
      />
    );
  const content =
    page === 'overview' ? (
      <OverviewPage client={client} goto={setPage} />
    ) : page === 'intakes' ? (
      <IntakesPage client={client} />
    ) : page === 'builder' ? (
      <BuilderPage client={client} />
    ) : page === 'quotes' ? (
      <QuotesPage client={client} />
    ) : page === 'prices' ? (
      <PricesPage client={client} />
    ) : page === 'operations' ? (
      <OperationsPage client={client} />
    ) : (
      <ConnectionPage client={client} connection={connection} onChange={() => setConnect(true)} />
    );
  const nav: Array<[Page, string, string]> = [
    ['overview', 'Overview', 'OV'],
    ['intakes', 'Leads / Intakes', 'IN'],
    ['builder', 'Build Quote', 'BQ'],
    ['quotes', 'Quotes', 'QT'],
    ['prices', 'Price Lookup', 'PR'],
    ['operations', 'Operations', 'OP'],
    ['connection', 'System', 'ST'],
  ];
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="logo">SB</div>
          <div>
            <b>SalesBot</b>
            <small>Operator Console</small>
          </div>
        </div>
        <nav>
          {nav.map(([key, label, short]) => (
            <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>
              <span>{short}</span>
              <b>{label}</b>
            </button>
          ))}
        </nav>
        <div className="tenant">
          <small>Tenant</small>
          <b>{connection.tenantId}</b>
        </div>
      </aside>
      <main>{content}</main>
    </div>
  );
}
export default App;
