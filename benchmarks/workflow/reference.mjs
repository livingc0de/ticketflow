/**
 * Reference solutions, used by tests only (never shown to an agent). For each scenario:
 *   solution    - files that make every requirement and regression check pass, leaving the planted defect in place
 *   defectFixes - files that additionally repair the planted defect(s)
 * Files overlay fixture(id) (W4: fixture(id,{withPR:true})).
 */
import { fixture } from './scenarios.mjs';

const raw = String.raw;

const solution = {
  W1: {
    'src/formats.mjs': raw`import {columns, cellValue} from './columns.mjs';

const clean = (value) => String(value).replace(/[\t\r\n]+/g, ' ');

export function toTsv(rows) {
  const head = columns.map((c) => c.label).join('\t');
  const body = rows.map((row) => columns.map((c) => clean(cellValue(row, c))).join('\t'));
  return [head, ...body].join('\n');
}

const quote = (value) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};

export function toCsv(rows) {
  const head = columns.map((c) => quote(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => quote(cellValue(row, c))).join(','));
  return [head, ...body].join('\n');
}
`,
    'src/export.mjs': raw`import {toTsv, toCsv} from './formats.mjs';

const formats = {tsv: toTsv, csv: toCsv};

export function exportReport(rows, format = 'tsv') {
  if (!Object.hasOwn(formats, format)) throw new Error('unknown format: ' + format);
  return formats[format](rows);
}
`,
  },
  W2: {
    'src/money.mjs': raw`// Amounts are in currency units, rounded half up to whole cents.
export const toCents = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;
`,
  },
  W3: {
    'src/store.mjs': raw`export function lookupOrder(orders, tenant, id) {
  return orders.find((o) => o.tenant === tenant && o.id === id) ?? null;
}
`,
    'src/paging.mjs': raw`export function page(rows, start, size) {
  const end = start + size;
  return {items: rows.slice(start, end), next: end < rows.length ? end : null};
}
`,
    'src/api.mjs': raw`import {lookupOrder} from './store.mjs';
import {page} from './paging.mjs';

export function getOrder(orders, tenant, id) {
  return lookupOrder(orders, tenant, id);
}

export function listOrders(orders, tenant, start, size) {
  return page(orders.filter((o) => o.tenant === tenant), start, size);
}
`,
  },
  W4: {
    'src/webhook.mjs': raw`export function applyEvent(state, event) {
  if (state.seen.includes(event.id)) return state;
  return {balance: state.balance + event.delta, seen: [...state.seen, event.id]};
}

export function reverseEvent(state, event) {
  if (!state.seen.includes(event.id)) return state;
  return {balance: state.balance - event.delta, seen: state.seen};
}
`,
    'src/batch.mjs': raw`import {applyEvent} from './webhook.mjs';

export function processBatch(state, events) {
  return events.reduce((next, event) => applyEvent(next, event), state);
}
`,
  },
  W5: {
    'src/orders.mjs': raw`export const initialState = () => ({status: 'created', history: []});

const next = {created: 'paid', paid: 'shipped'};

export function transition(state, event) {
  if (state.history.includes(event.id) || next[state.status] !== event.to) return state;
  return {status: event.to, history: [...state.history, event.id]};
}
`,
    'src/events.mjs': raw`import {initialState, transition} from './orders.mjs';

// Events carry a seq number; replay applies them in seq order.
export function replay(events, from = initialState()) {
  const ordered = events.sort((a, b) => a.seq - b.seq);
  return ordered.reduce((state, event) => transition(state, event), from);
}

export function checkpoint(events) {
  return {state: replay(events), cursor: events.reduce((max, e) => Math.max(max, e.seq), 0)};
}

export function resume(cp, moreEvents) {
  return replay(moreEvents.filter((e) => e.seq > cp.cursor), cp.state);
}
`,
  },
  W6: {
    'src/catalog.mjs': raw`const plans = [
  {id: 'basic', priceCents: 990, seats: 1, features: ['sync']},
  {id: 'pro', priceCents: 1990, seats: 3, features: ['sync', 'export']},
  {id: 'team', priceCents: 4900, seats: 10, features: ['sync', 'export', 'audit']},
];

export const listPlans = () => plans.map((p) => ({...p, features: [...p.features]}));

export function findPlan(id) {
  return plans.find((p) => String(id).startsWith(p.id)) ?? null;
}
`,
    'src/subscription.mjs': raw`import {findPlan} from './catalog.mjs';
import {CYCLE_DAYS} from './dates.mjs';

export const EXTRA_SEAT_CENTS = 300;

function plan(id) {
  const found = findPlan(id);
  if (!found) throw new Error('unknown plan: ' + id);
  return found;
}

function active(sub) {
  if (sub.status === 'cancelled') throw new Error('subscription is cancelled');
}

export function openSubscription(planId, day) {
  const p = plan(planId);
  return {planId: p.id, status: 'active', startDay: day, renewalDay: day + CYCLE_DAYS, seats: p.seats, seen: []};
}

export const cancelSubscription = (sub) => (sub.status === 'cancelled' ? sub : {...sub, status: 'cancelled'});

export function renewSubscription(sub, day) {
  if (sub.status === 'cancelled' || day < sub.renewalDay) return sub;
  return {...sub, renewalDay: sub.renewalDay + CYCLE_DAYS};
}

export function previewInvoice(sub) {
  if (sub.status === 'cancelled') return {planId: sub.planId, amountCents: 0};
  const p = plan(sub.planId);
  const extra = Math.max(0, sub.seats - p.seats);
  return {planId: sub.planId, amountCents: p.priceCents + extra * EXTRA_SEAT_CENTS};
}

export const hasFeature = (sub, name) => sub.status !== 'cancelled' && plan(sub.planId).features.includes(name);

export function addSeats(sub, count) {
  if (!Number.isInteger(count) || count <= 0) throw new Error('count must be a positive integer');
  active(sub);
  return {...sub, seats: sub.seats + count};
}

export function changePlan(sub, planId, day) {
  active(sub);
  const to = plan(planId);
  const from = plan(sub.planId);
  const left = Math.max(0, sub.renewalDay - day);
  return {...sub, planId: to.id, adjustmentCents: Math.round(((to.priceCents - from.priceCents) * left) / CYCLE_DAYS)};
}

export function recordPayment(sub, event) {
  if (sub.seen.includes(event.id)) return sub;
  const seen = [...sub.seen, event.id];
  if (sub.status === 'cancelled') return {...sub, seen};
  return {...sub, seen, status: event.ok ? 'active' : 'past_due'};
}
`,
  },
  W7: {
    'src/html.mjs': raw`const entities = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => entities[c]);
}
`,
    'src/render.mjs': raw`import {escapeHtml} from './html.mjs';

export function renderMessage(text) {
  return '<p>' + escapeHtml(text) + '</p>';
}

export function renderLink(href, title) {
  return '<a href="' + escapeHtml(href) + '">' + title + '</a>';
}
`,
    'src/paging.mjs': raw`export function page(items, offset, limit) {
  const end = offset + limit;
  return {items: items.slice(offset, end), next: end < items.length ? end : null};
}
`,
    'src/money.mjs': raw`export const toCents = (value) => Math.round((value + Number.EPSILON) * 100);
`,
    'src/ids.mjs': raw`export function parseRequestId(value) {
  if (typeof value !== 'string') return null;
  const id = value.toLowerCase();
  return /^[0-9a-f]{8}$/.test(id) ? id : null;
}
`,
    'src/slug.mjs': raw`export const slugify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
`,
  },
};

const defectFixes = {
  W1: {},
  W2: {
    'src/settlement.mjs': raw`import {invoiceTotal} from './invoice.mjs';
import {refundTotal} from './refund.mjs';
import {toCents} from './money.mjs';

// vatBp is the VAT rate in basis points (1000 = 10%)
export function settle(lines, refunds, vatBp) {
  const net = invoiceTotal(lines);
  const refunded = refundTotal(refunds);
  const taxable = toCents(net - refunded);
  const vat = toCents(taxable * vatBp / 10000);
  return {net, refunded, vat, due: toCents(taxable + vat)};
}
`,
  },
  W3: {
    'src/summary.mjs': raw`import {lookupOrder} from './store.mjs';

// Short description of one order for the dashboard.
export function orderSummary(orders, tenant, id) {
  const order = lookupOrder(orders, tenant, id);
  if (!order) return null;
  return {tenant, id: order.id, total: order.total, lines: order.lines.length};
}
`,
  },
  W4: {
    'src/webhook.mjs': raw`export function applyEvent(state, event) {
  if (state.seen.includes(event.id)) return state;
  return {balance: state.balance + event.delta, seen: [...state.seen, event.id]};
}

export function reverseEvent(state, event) {
  const key = 'reversed:' + event.id;
  if (!state.seen.includes(event.id) || state.seen.includes(key)) return state;
  return {balance: state.balance - event.delta, seen: [...state.seen, key]};
}
`,
  },
  W5: {
    'src/events.mjs': raw`import {initialState, transition} from './orders.mjs';

// Events carry a seq number; replay applies them in seq order.
export function replay(events, from = initialState()) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  return ordered.reduce((state, event) => transition(state, event), from);
}

export function checkpoint(events) {
  return {state: replay(events), cursor: events.reduce((max, e) => Math.max(max, e.seq), 0)};
}

export function resume(cp, moreEvents) {
  return replay(moreEvents.filter((e) => e.seq > cp.cursor), cp.state);
}
`,
  },
  W6: {
    'src/catalog.mjs': raw`const plans = [
  {id: 'basic', priceCents: 990, seats: 1, features: ['sync']},
  {id: 'pro', priceCents: 1990, seats: 3, features: ['sync', 'export']},
  {id: 'team', priceCents: 4900, seats: 10, features: ['sync', 'export', 'audit']},
];

export const listPlans = () => plans.map((p) => ({...p, features: [...p.features]}));

export function findPlan(id) {
  return plans.find((p) => p.id === id) ?? null;
}
`,
  },
  W7: {
    'src/render.mjs': raw`import {escapeHtml} from './html.mjs';

export function renderMessage(text) {
  return '<p>' + escapeHtml(text) + '</p>';
}

export function renderLink(href, title) {
  return '<a href="' + escapeHtml(href) + '">' + escapeHtml(title) + '</a>';
}
`,
    'src/tenant-pages.mjs': raw`import {page} from './paging.mjs';

export function tenantPage(items, tenant, offset, limit) {
  const mine = items.filter((i) => i.tenant === tenant);
  return {...page(mine, offset, limit), total: mine.length};
}
`,
  },
};

/** Complete file set of a repository holding the reference solution (defects left in unless fixed). */
export function reference(id, {fixDefects = true} = {}) {
  if (!solution[id]) throw Error('no reference for ' + id);
  return {...fixture(id, {withPR: true}), ...solution[id], ...(fixDefects ? defectFixes[id] : {})};
}
/** Reference solution with the planted defect left unfixed. */
export const referenceMinusDefects = (id) => reference(id, {fixDefects: false});
