/**
 * Workflow benchmark scenarios. Everything an agent can see (files, ticket text, PR text, prompts)
 * reads like an ordinary small project and carries no scenario id, arm name or process wording.
 * Checks are hidden: they run through entry points that exist in the fixture or are named in the
 * ticket/brief, and never ship into the repository.
 *
 * Scenario: {title,size,issues:[{title,body}],files,seedPR?,sessions:[{prompt,interrupt?,timeoutMin}],
 *   checks:[{id,kind:'req'|'reg'|'defect',text,source:'ticket'|'brief'|'code'|'standard',file?,code,supersededBy?}],
 *   scope:[globs],timeoutMin}
 * A check body is async module code with `assert`, `dir` (the checkout) and `load(relPath)` in scope.
 * `{#n}` in ticket text and `{pr}` in prompts are replaced by the seeded numbers.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const raw = String.raw;
const common = {
  'package.json': JSON.stringify({name:'service',version:'1.0.0',private:true,type:'module',scripts:{test:'node --test test/*.test.mjs'}}, null, 2) + '\n',
  '.github/workflows/test.yml': raw`name: test
on: [push, pull_request]
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm test
`,
  '.gitignore': 'node_modules/\n',
};
const testFile = (imports, body) => "import test from 'node:test';\nimport assert from 'node:assert/strict';\n" + imports + '\n' + body + '\n';
const freezeHelper = "const freeze=(o)=>{Object.freeze(o);for(const v of Object.values(o))if(v&&typeof v==='object')freeze(v);return o;};\n";
const DEFAULT_SCOPE = ['src/**', 'test/**', 'docs/**', '*.md'];

/* ---------------------------------------------------------------- W1 */
const W1 = {
  title: 'Add a CSV option to an existing export',
  size: 'one',
  issues: [],
  files: {
    'src/columns.mjs': raw`export const columns = [
  {key: 'name', label: 'Name'},
  {key: 'qty', label: 'Qty'},
  {key: 'total', label: 'Total'},
];

export const cellValue = (row, col) => row[col.key] ?? '';
`,
    'src/formats.mjs': raw`import {columns, cellValue} from './columns.mjs';

const clean = (value) => String(value).replace(/[\t\r\n]+/g, ' ');

export function toTsv(rows) {
  const head = columns.map((c) => c.label).join('\t');
  const body = rows.map((row) => columns.map((c) => clean(cellValue(row, c))).join('\t'));
  return [head, ...body].join('\n');
}
`,
    'src/export.mjs': raw`import {toTsv} from './formats.mjs';

const formats = {tsv: toTsv};

export function exportReport(rows, format = 'tsv') {
  if (!Object.hasOwn(formats, format)) throw new Error('unknown format: ' + format);
  return formats[format](rows);
}
`,
    'test/export.test.mjs': testFile("import {exportReport} from '../src/export.mjs';", raw`test('tsv output', () => {
  assert.equal(exportReport([{name: 'pen', qty: 2, total: '3.50'}], 'tsv'), 'Name\tQty\tTotal\npen\t2\t3.50');
});
test('unknown format is rejected', () => {
  assert.throws(() => exportReport([], 'xml'), /unknown format/);
});`),
  },
  sessions: [{prompt: 'Could you add a CSV option next to the TSV export? It\'s exportReport in src/export.mjs.', timeoutMin: 35}],
  checks: [
    {id: 'csv-header', kind: 'req', source: 'code', file: 'src/export.mjs', text: 'CSV output starts with the same column labels the TSV uses, comma separated, one row per line',
      code: raw`const {exportReport}=await load('src/export.mjs');const csv=(rows)=>exportReport(rows,'csv').replace(/\r\n/g,'\n');
assert.equal(csv([{name:'pen',qty:2,total:'3.50'},{name:'ink',qty:1}]),'Name,Qty,Total\npen,2,3.50\nink,1,');`},
    {id: 'csv-comma', kind: 'req', source: 'standard', file: 'src/export.mjs', text: 'a value containing a comma is quoted',
      code: raw`const {exportReport}=await load('src/export.mjs');const csv=(rows)=>exportReport(rows,'csv').replace(/\r\n/g,'\n');
assert.equal(csv([{name:'pen, blue',qty:1,total:2}]),'Name,Qty,Total\n"pen, blue",1,2');`},
    {id: 'csv-escape', kind: 'req', source: 'standard', file: 'src/export.mjs', text: 'quotes are doubled and values with line breaks are quoted',
      code: raw`const {exportReport}=await load('src/export.mjs');const csv=(rows)=>exportReport(rows,'csv').replace(/\r\n/g,'\n');
assert.equal(csv([{name:'say "hi"',qty:1,total:2}]),'Name,Qty,Total\n"say ""hi""",1,2');
assert.equal(csv([{name:'a\nb',qty:1,total:2}]),'Name,Qty,Total\n"a\nb",1,2');`},
    {id: 'csv-empty', kind: 'req', source: 'code', file: 'src/export.mjs', text: 'no rows gives just the header, as the TSV does',
      code: raw`const {exportReport}=await load('src/export.mjs');const csv=(rows)=>exportReport(rows,'csv').replace(/\r\n/g,'\n');
assert.equal(csv([]),'Name,Qty,Total');`},
    {id: 'tsv-unchanged', kind: 'reg', source: 'code', file: 'src/export.mjs', text: 'TSV output and the default format are unchanged',
      code: raw`const {exportReport}=await load('src/export.mjs');
const rows=[{name:'a\tb',qty:2,total:'3.50'}];
assert.equal(exportReport(rows,'tsv'),'Name\tQty\tTotal\na b\t2\t3.50');
assert.equal(exportReport(rows),exportReport(rows,'tsv'));`},
    {id: 'unknown-format', kind: 'reg', source: 'code', file: 'src/export.mjs', text: 'an unknown format still throws',
      code: raw`const {exportReport}=await load('src/export.mjs');
assert.throws(()=>exportReport([],'xml'));
assert.throws(()=>exportReport([],'constructor'));`},
  ],
  scope: DEFAULT_SCOPE,
  timeoutMin: 35,
};

/* ---------------------------------------------------------------- W2 */
const W2 = {
  title: 'Rounding bug in money handling',
  size: 'one',
  issues: [{
    title: 'Refund came out a cent short',
    body: 'Customer bought one at 1.005. The refund said 1.00, so they got back less than they paid (the invoice they have says 1.01). '
      + 'Might be the same story with other half-cent amounts, and I wouldn\'t be surprised if invoices round the same way. Haven\'t had time to dig.',
  }],
  files: {
    'src/money.mjs': raw`// Amounts are in currency units, rounded to whole cents.
export const toCents = (amount) => Math.floor(amount * 100) / 100;
`,
    'src/invoice.mjs': raw`import {toCents} from './money.mjs';

export const invoiceLine = (price, qty) => toCents(price * qty);

export const invoiceTotal = (lines) => toCents(lines.reduce((sum, l) => sum + invoiceLine(l.price, l.qty), 0));
`,
    'src/refund.mjs': raw`import {toCents} from './money.mjs';

export const refundLine = (price, qty) => toCents(price * qty);

export const refundTotal = (lines) => toCents(lines.reduce((sum, l) => sum + refundLine(l.price, l.qty), 0));
`,
    'src/settlement.mjs': raw`import {invoiceTotal} from './invoice.mjs';
import {refundTotal} from './refund.mjs';
import {toCents} from './money.mjs';

// vatBp is the VAT rate in basis points (1000 = 10%)
export function settle(lines, refunds, vatBp) {
  const net = invoiceTotal(lines);
  const refunded = refundTotal(refunds);
  const taxable = toCents(net - refunded);
  const vat = Math.floor(taxable * vatBp / 10000 * 100) / 100;
  return {net, refunded, vat, due: toCents(taxable + vat)};
}
`,
    'test/money.test.mjs': testFile("import {invoiceLine} from '../src/invoice.mjs';\nimport {refundLine} from '../src/refund.mjs';\nimport {settle} from '../src/settlement.mjs';", raw`test('whole amounts', () => {
  assert.equal(invoiceLine(2, 2), 4);
  assert.equal(refundLine(3, 2), 6);
});
test('settlement of a simple order', () => {
  assert.deepEqual(settle([{price: 20, qty: 1}], [], 1000), {net: 20, refunded: 0, vat: 2, due: 22});
});`),
  },
  sessions: [{prompt: 'Can you take a look at issue {#1}?', timeoutMin: 35}],
  checks: [
    {id: 'refund-half-cent', kind: 'req', source: 'ticket', file: 'src/refund.mjs', text: 'refundLine(1.005, 1) is 1.01',
      code: raw`const {refundLine}=await load('src/refund.mjs');
assert.equal(refundLine(1.005,1),1.01);`},
    {id: 'invoice-half-cent', kind: 'req', source: 'ticket', file: 'src/invoice.mjs', text: 'invoiceLine(1.005, 1) is 1.01',
      code: raw`const {invoiceLine}=await load('src/invoice.mjs');
assert.equal(invoiceLine(1.005,1),1.01);`},
    {id: 'tocents-half-cent', kind: 'req', source: 'ticket', file: 'src/money.mjs', text: 'toCents(2.015) is 2.02 (other half-cent amounts)',
      code: raw`const {toCents}=await load('src/money.mjs');
assert.equal(toCents(2.015),2.02);`},
    {id: 'whole-amounts', kind: 'reg', source: 'code', file: 'src/invoice.mjs', text: 'whole amounts and sums are unchanged',
      code: raw`const {invoiceLine,invoiceTotal}=await load('src/invoice.mjs');
const {refundLine}=await load('src/refund.mjs');
const {toCents}=await load('src/money.mjs');
assert.equal(invoiceLine(2,2),4);
assert.equal(refundLine(3,2),6);
assert.equal(invoiceTotal([{price:2,qty:2},{price:1.5,qty:2}]),7);
assert.equal(toCents(0.1+0.2),0.3);`},
    {id: 'vat-rounding', kind: 'defect', source: 'code', file: 'src/settlement.mjs', scopeFiles: ['src/money.mjs'], text: 'VAT in settle() is rounded half up through the same rounding as everything else (10.05 at 10% gives 1.01)',
      code: raw`const {settle}=await load('src/settlement.mjs');
assert.equal(settle([{price:10.05,qty:1}],[],1000).vat,1.01);`},
  ],
  scope: DEFAULT_SCOPE,
  timeoutMin: 35,
};

/* ---------------------------------------------------------------- W3 */
const orderRows = "const o=(id,tenant,total=1)=>({id,tenant,total,lines:[{sku:'x',qty:1}]});\n";
const W3 = {
  title: 'Order API: tenant mix-ups and paging',
  size: 'few',
  issues: [
    {title: 'Customers see each other\'s orders',
      body: 'Two shops can both have an order 1001 (ids are only unique within a shop, as far as I know) and when one of them opens it in the app they sometimes get the other shop\'s. getOrder in src/api.mjs.'},
    {title: 'Last page still says there\'s more',
      body: 'listOrders always hands back a next even on the very last page, so the app keeps asking for another one that\'s empty. Also worth making sure the pages line up with each other.'},
    {title: 'Order API should only return the caller\'s orders',
      body: 'After {#1} and {#2}, make the order API (getOrder and listOrders) only return the caller\'s own orders, including when paging through them.'},
  ],
  files: {
    'src/store.mjs': raw`export function lookupOrder(orders, id) {
  return orders.find((o) => o.id === id) ?? null;
}
`,
    'src/paging.mjs': raw`export function page(rows, start, size) {
  return {items: rows.slice(start, start + size), next: start + size};
}
`,
    'src/api.mjs': raw`import {lookupOrder} from './store.mjs';
import {page} from './paging.mjs';

export function getOrder(orders, tenant, id) {
  return lookupOrder(orders, id);
}

export function listOrders(orders, tenant, start, size) {
  return page(orders, start, size);
}
`,
    'src/summary.mjs': raw`// Short description of one order for the dashboard.
export function orderSummary(orders, tenant, id) {
  const order = orders.find((o) => o.id === id);
  if (!order) return null;
  return {tenant, id: order.id, total: order.total, lines: order.lines.length};
}
`,
    'test/api.test.mjs': testFile("import {getOrder, listOrders} from '../src/api.mjs';\nimport {orderSummary} from '../src/summary.mjs';", orderRows + raw`test('lists orders', () => {
  assert.equal(listOrders([o(1, 'a')], 'a', 0, 10).items.length, 1);
});
test('gets an order', () => {
  assert.equal(getOrder([o(1, 'a')], 'a', 1).id, 1);
  assert.equal(getOrder([o(1, 'a')], 'a', 2), null);
});
test('summarises an order', () => {
  assert.deepEqual(orderSummary([o(1, 'a', 9)], 'a', 1), {tenant: 'a', id: 1, total: 9, lines: 1});
});`),
  },
  sessions: [{prompt: 'Please work through the open issues.', timeoutMin: 35}],
  checks: [
    {id: 'tenant-lookup', kind: 'req', source: 'ticket', file: 'src/api.mjs', text: 'getOrder returns the caller\'s order when ids collide across tenants, and null for another tenant\'s',
      code: orderRows + raw`const {getOrder}=await load('src/api.mjs');
const orders=[o(1,'b',5),o(1,'a',7),o(2,'b',3)];
assert.deepEqual(getOrder(orders,'a',1),orders[1]);
assert.equal(getOrder(orders,'a',2),null);
assert.equal(getOrder(orders,'c',1),null);`},
    {id: 'page-last', kind: 'req', source: 'ticket', file: 'src/api.mjs', text: 'next is null on the last page (including an exactly full last page) and pages are contiguous',
      code: orderRows + raw`const {listOrders}=await load('src/api.mjs');const L=(...a)=>{const r=listOrders(...a);return {...r,next:r.next??null};};
const orders=[o(1,'a'),o(2,'a'),o(3,'a')];
const first=L(orders,'a',0,2);
assert.deepEqual(first.items,[orders[0],orders[1]]);
assert.equal(first.next,2);
const second=L(orders,'a',first.next,2);
assert.deepEqual(second,{items:[orders[2]],next:null});
assert.equal(L(orders,'a',1,2).next,null);`},
    {id: 'list-tenant', kind: 'req', source: 'ticket', file: 'src/api.mjs', text: 'listOrders only returns the caller\'s orders, and pages over the caller\'s orders only',
      code: orderRows + raw`const {listOrders}=await load('src/api.mjs');const L=(...a)=>{const r=listOrders(...a);return {...r,next:r.next??null};};
const orders=[o(1,'a'),o(2,'b'),o(3,'a'),o(4,'b'),o(5,'a')];
assert.deepEqual(L(orders,'a',0,2),{items:[orders[0],orders[2]],next:2});
assert.deepEqual(L(orders,'a',2,2),{items:[orders[4]],next:null});
assert.deepEqual(L(orders,'c',0,2),{items:[],next:null});`},
    {id: 'single-tenant-basics', kind: 'reg', source: 'code', file: 'src/api.mjs', text: 'a single tenant still gets its orders in order, and unknown ids give null',
      code: orderRows + raw`const {getOrder,listOrders}=await load('src/api.mjs');
const orders=[o(1,'a'),o(2,'a')];
assert.deepEqual(getOrder(orders,'a',2),orders[1]);
assert.equal(getOrder(orders,'a',99),null);
assert.deepEqual(listOrders(orders,'a',0,10).items,orders);`},
    {id: 'summary-tenant', kind: 'defect', source: 'code', file: 'src/summary.mjs', scopeFiles: ['src/store.mjs', 'src/api.mjs'], text: 'orderSummary also looks orders up per tenant (colliding ids)',
      code: orderRows + raw`const {orderSummary}=await load('src/summary.mjs');
const orders=[o(1,'b',5),o(1,'a',7)];
assert.equal(orderSummary(orders,'a',1).total,7);
assert.equal(orderSummary(orders,'c',1),null);`},
  ],
  scope: DEFAULT_SCOPE,
  timeoutMin: 35,
};

/* ---------------------------------------------------------------- W4 */
const W4 = {
  title: 'Red pull request for webhook batching',
  size: 'one',
  issues: [],
  files: {
    'src/state.mjs': raw`export const emptyState = () => ({balance: 0, seen: []});
`,
    'src/webhook.mjs': raw`// Payment webhooks can be delivered more than once; the seen list makes handling idempotent.
export function applyEvent(state, event) {
  if (state.seen.includes(event.id)) return state;
  return {balance: state.balance + event.delta, seen: [...state.seen, event.id]};
}

export function reverseEvent(state, event) {
  const key = 'reversed:' + event.id;
  if (!state.seen.includes(event.id) || state.seen.includes(key)) return state;
  return {balance: state.balance - event.delta, seen: [...state.seen, key]};
}
`,
    'test/webhook.test.mjs': testFile("import {emptyState} from '../src/state.mjs';\nimport {applyEvent, reverseEvent} from '../src/webhook.mjs';", raw`const e = {id: 'a', delta: 2};
test('duplicate deliveries count once', () => {
  assert.equal(applyEvent(applyEvent(emptyState(), e), e).balance, 2);
});
test('reversing an event takes it back', () => {
  assert.equal(reverseEvent(applyEvent(emptyState(), e), e).balance, 0);
});`),
  },
  seedPR: {
    branch: 'webhook-batch',
    title: 'Batch processing for payment webhooks',
    body: 'Adds processBatch so a whole delivery can be applied in one go instead of event by event. Also tidied up the handlers in webhook.mjs while I was in there.',
    commitMessage: 'Add batch processing for payment webhooks',
    comment: 'the dedupe test fails, looks like the duplicate check got lost?',
    changes: {
      'src/webhook.mjs': raw`export function applyEvent(state, event) {
  return {balance: state.balance + event.delta, seen: [...state.seen, event.id]};
}

export function reverseEvent(state, event) {
  if (!state.seen.includes(event.id)) return state;
  return {balance: state.balance - event.delta, seen: state.seen};
}
`,
      'src/batch.mjs': raw`import {applyEvent} from './webhook.mjs';

export function processBatch(state, events) {
  const next = state;
  for (const event of events) {
    const result = applyEvent(next, event);
    next.balance = result.balance;
    next.seen = result.seen;
  }
  return next;
}
`,
      'test/batch.test.mjs': testFile("import {emptyState} from '../src/state.mjs';\nimport {processBatch} from '../src/batch.mjs';", raw`test('applies a batch of events', () => {
  const state = processBatch(emptyState(), [{id: 'a', delta: 2}, {id: 'b', delta: 3}]);
  assert.equal(state.balance, 5);
});`),
    },
  },
  sessions: [{prompt: 'PR {pr} is red and has a comment on it, can you sort it out?', timeoutMin: 35}],
  checks: [
    {id: 'batch-applies', kind: 'req', source: 'code', file: 'src/batch.mjs', text: 'processBatch applies every event of a delivery and records their ids',
      code: raw`const {processBatch}=await load('src/batch.mjs');
const {emptyState}=await load('src/state.mjs');
const s=processBatch(emptyState(),[{id:'a',delta:2},{id:'b',delta:3}]);
assert.equal(s.balance,5);
assert.deepEqual(s.seen,['a','b']);`},
    {id: 'batch-dedupe', kind: 'req', source: 'code', file: 'src/batch.mjs', text: 'an event repeated inside a batch, or in a later batch, counts once',
      code: raw`const {processBatch}=await load('src/batch.mjs');
const {emptyState}=await load('src/state.mjs');
const s=processBatch(emptyState(),[{id:'a',delta:2},{id:'a',delta:2},{id:'b',delta:3}]);
assert.equal(s.balance,5);
assert.equal(processBatch(s,[{id:'a',delta:2}]).balance,5);`},
    {id: 'batch-immutable', kind: 'req', source: 'code', file: 'src/batch.mjs', text: 'processBatch does not modify the state it is given',
      code: freezeHelper + raw`const {processBatch}=await load('src/batch.mjs');
const {emptyState}=await load('src/state.mjs');
const start=freeze(emptyState());
const s=processBatch(start,[{id:'a',delta:2}]);
assert.equal(s.balance,2);
assert.deepEqual(start,{balance:0,seen:[]});`},
    {id: 'apply-dedupe', kind: 'reg', source: 'code', file: 'src/webhook.mjs', text: 'applyEvent ignores an event id it has already seen',
      code: raw`const {applyEvent}=await load('src/webhook.mjs');
const {emptyState}=await load('src/state.mjs');
const e={id:'a',delta:2};
const once=applyEvent(emptyState(),e);
assert.equal(applyEvent(once,e).balance,2);`},
    {id: 'apply-immutable', kind: 'reg', source: 'code', file: 'src/webhook.mjs', text: 'applyEvent does not modify the state it is given',
      code: freezeHelper + raw`const {applyEvent}=await load('src/webhook.mjs');
const {emptyState}=await load('src/state.mjs');
const start=freeze(emptyState());
assert.equal(applyEvent(start,{id:'a',delta:2}).balance,2);`},
    {id: 'reverse-once', kind: 'defect', source: 'code', file: 'src/webhook.mjs', text: 'reversing the same event twice only takes it back once',
      code: raw`const {applyEvent,reverseEvent}=await load('src/webhook.mjs');
const {emptyState}=await load('src/state.mjs');
const e={id:'x',delta:5};
const once=reverseEvent(applyEvent(emptyState(),e),e);
assert.equal(once.balance,0);
assert.equal(reverseEvent(once,e).balance,0);`},
  ],
  scope: DEFAULT_SCOPE,
  timeoutMin: 35,
};

/* ---------------------------------------------------------------- W5 */
const W5 = {
  title: 'Order status rules and checkpoints',
  size: 'one',
  issues: [{
    title: 'Order status handling needs tightening',
    body: 'Orders should only go created -> paid -> shipped; anything else should just be ignored. The same event id twice should only count once. '
      + 'And transition shouldn\'t change the state it\'s given, we keep old states around for replays.\n\n'
      + 'We also want to be able to checkpoint: checkpoint(events) in src/events.mjs gives back {state, cursor}: the state so far and '
      + 'the seq of the last event it covers, and resume(cp, moreEvents) carries on from there. Resuming should end up exactly where a full replay of everything would.',
  }],
  files: {
    'src/orders.mjs': raw`export const initialState = () => ({status: 'created', history: []});

export function transition(state, event) {
  state.status = event.to;
  state.history.push(event.id);
  return state;
}
`,
    'src/events.mjs': raw`import {initialState, transition} from './orders.mjs';

// Events carry a seq number; replay applies them in seq order.
export function replay(events, from = initialState()) {
  const ordered = events.sort((a, b) => a.seq - b.seq);
  return ordered.reduce((state, event) => transition(state, event), from);
}
`,
    'test/orders.test.mjs': testFile("import {initialState, transition} from '../src/orders.mjs';\nimport {replay} from '../src/events.mjs';", raw`test('created to paid', () => {
  assert.equal(transition(initialState(), {id: 'e1', to: 'paid'}).status, 'paid');
});
test('replay applies events in seq order', () => {
  const events = [{id: 'e2', to: 'shipped', seq: 2}, {id: 'e1', to: 'paid', seq: 1}];
  assert.equal(replay(events).status, 'shipped');
});`),
  },
  sessions: [
    {prompt: 'Can you pick up issue {#1}?', interrupt: true, timeoutMin: 25},
    {prompt: 'Continue where we left off.', timeoutMin: 25},
  ],
  checks: [
    {id: 'legal-transitions', kind: 'req', source: 'ticket', file: 'src/orders.mjs', text: 'only created -> paid -> shipped is accepted; anything else leaves the state unchanged',
      code: freezeHelper + raw`const {initialState,transition}=await load('src/orders.mjs');
const created=initialState();
const paid=transition(created,{id:'e1',to:'paid'});
assert.equal(paid.status,'paid');
assert.equal(transition(paid,{id:'e2',to:'shipped'}).status,'shipped');
assert.deepEqual(transition(freeze(initialState()),{id:'e3',to:'shipped'}),initialState());
assert.deepEqual(transition(freeze({status:'paid',history:['e1']}),{id:'e4',to:'created'}),{status:'paid',history:['e1']});
assert.deepEqual(transition(freeze({status:'shipped',history:['e1','e2']}),{id:'e5',to:'paid'}),{status:'shipped',history:['e1','e2']});`},
    {id: 'dedupe-event-id', kind: 'req', source: 'ticket', file: 'src/orders.mjs', text: 'an event id that is already in the history is ignored',
      code: freezeHelper + raw`const {transition}=await load('src/orders.mjs');
const paid=freeze({status:'paid',history:['e1']});
assert.deepEqual(transition(paid,{id:'e1',to:'shipped'}),{status:'paid',history:['e1']});`},
    {id: 'transition-immutable', kind: 'req', source: 'ticket', file: 'src/orders.mjs', text: 'transition returns a new state and leaves its input untouched',
      code: freezeHelper + raw`const {initialState,transition}=await load('src/orders.mjs');
const start=freeze(initialState());
const next=transition(start,{id:'e1',to:'paid'});
assert.deepEqual(next,{status:'paid',history:['e1']});
assert.deepEqual(start,{status:'created',history:[]});`},
    {id: 'checkpoint-cursor', kind: 'req', source: 'ticket', file: 'src/events.mjs', text: 'checkpoint(events) gives the state so far and a cursor equal to the last seq it covers',
      code: raw`const {checkpoint,replay}=await load('src/events.mjs');
const e1={id:'e1',to:'paid',seq:1}, e2={id:'e2',to:'shipped',seq:2};
const cp=checkpoint([{...e1}]);
assert.equal(cp.cursor,1);
assert.deepEqual(cp.state,replay([{...e1}]));
assert.equal(checkpoint([{...e1},{...e2}]).cursor,2);`},
    {id: 'resume-equals-replay', kind: 'req', source: 'ticket', file: 'src/events.mjs', text: 'resume(cp, moreEvents) ends where a full replay would, also when moreEvents overlaps what the checkpoint covers',
      code: raw`const {checkpoint,resume,replay}=await load('src/events.mjs');
const all=()=>[{id:'e1',to:'paid',seq:1},{id:'e2',to:'shipped',seq:2}];
const full=replay(all());
const cp=checkpoint([all()[0]]);
assert.deepEqual(resume(cp,[all()[1]]),full);
assert.deepEqual(resume(cp,all()),full);`},
    {id: 'replay-in-order', kind: 'reg', source: 'code', file: 'src/events.mjs', text: 'replay still applies events in seq order',
      code: raw`const {replay}=await load('src/events.mjs');
const s=replay([{id:'e2',to:'shipped',seq:2},{id:'e1',to:'paid',seq:1}]);
assert.equal(s.status,'shipped');
assert.deepEqual(s.history,['e1','e2']);`},
    {id: 'replay-keeps-input', kind: 'defect', source: 'code', file: 'src/events.mjs', text: 'replay does not reorder the caller\'s events array',
      code: raw`const {replay}=await load('src/events.mjs');
const events=[{id:'e2',to:'shipped',seq:2},{id:'e1',to:'paid',seq:1}];
replay(events);
assert.deepEqual(events.map((e)=>e.id),['e2','e1']);`},
  ],
  scope: DEFAULT_SCOPE,
  timeoutMin: 50,
};

/* ---------------------------------------------------------------- W6 */
const W6_README = `# Subscriptions

We want recurring billing in the app. Here's roughly what we have in mind, in no particular order:

- Add a third plan, \`team\`: 49.00 a month, 10 seats included, same features as pro plus \`audit\`. The basic and pro plans are in \`src/catalog.mjs\` already.
- Opening a subscription: pick a plan and a start day. It starts active with the plan's seats included and renews 30 days after the start day. An unknown plan is an error.
- Cancelling takes effect right away. Cancelling twice is harmless.
- Renewing: once the renewal day has come (or gone), move the renewal day on by one cycle from the old renewal day, not from whenever we got round to it. Before that day nothing changes.
- Invoice preview: what the customer will be billed at the next renewal, in cents (plan price plus any extra seats, see below). Cancelled subscriptions owe nothing.
- Features: say whether a subscription includes a feature (the lists are in the catalog). Cancelled subscriptions have none.
- Seats: a plan includes some seats and you can add more. Each extra seat is 3.00 per cycle. Adding zero or a negative number is an error, and so is adding seats to a cancelled subscription.
- Changing plan: switch to another plan, keeping the renewal day. An unknown plan is an error, and so is changing a cancelled subscription.
- Mid-cycle changes: when the plan is switched part way through the cycle, work out the price difference for the days left until renewal (prices are per 30 day cycle) and put it on the subscription as \`adjustmentCents\` (positive means the customer owes us, negative is a credit). Round to the nearest cent.
- Payments: a failed payment makes the subscription \`past_due\`, a successful one makes it \`active\` again. Payment events can be delivered more than once (they have an \`id\`), so a repeated event must change nothing the second time.
- A cancelled subscription never comes back on its own: no payment, renewal or plan change brings it back to active.

## Rough API we had in mind

All of it in \`src/subscription.mjs\`. A subscription is a plain object \`{planId, status, startDay, renewalDay, seats, seen}\`: status is \`active\`, \`past_due\` or \`cancelled\`, days are plain day numbers (a cycle is 30 days, see \`src/dates.mjs\`), \`seats\` is the total including extras and \`seen\` lists the payment event ids handled so far. Functions return a new subscription and never change the one you pass in.

- \`openSubscription(planId, day)\`
- \`cancelSubscription(sub)\`
- \`renewSubscription(sub, day)\` (day is today)
- \`previewInvoice(sub)\` gives \`{planId, amountCents}\`
- \`hasFeature(sub, name)\`
- \`addSeats(sub, count)\`
- \`changePlan(sub, planId, day)\` (day is today)
- \`recordPayment(sub, event)\` with event \`{id, ok}\`
`;
const sub = "const {openSubscription,cancelSubscription,renewSubscription,previewInvoice,hasFeature,addSeats,changePlan,recordPayment}=await load('src/subscription.mjs');\n";
const W6 = {
  title: 'Subscriptions from a rough brief',
  size: 'many',
  issues: [],
  files: {
    'README.md': W6_README,
    'src/dates.mjs': raw`export const CYCLE_DAYS = 30;

export const addDays = (day, n) => day + n;
`,
    'src/catalog.mjs': raw`const plans = [
  {id: 'basic', priceCents: 990, seats: 1, features: ['sync']},
  {id: 'pro', priceCents: 1990, seats: 3, features: ['sync', 'export']},
];

export const listPlans = () => plans.map((p) => ({...p, features: [...p.features]}));

export function findPlan(id) {
  return plans.find((p) => String(id).startsWith(p.id)) ?? null;
}
`,
    'test/catalog.test.mjs': testFile("import {listPlans, findPlan} from '../src/catalog.mjs';", raw`test('lists the plans', () => {
  assert.ok(['basic', 'pro'].every((id) => listPlans().some((p) => p.id === id)));
});
test('finds a plan by id', () => {
  assert.equal(findPlan('pro').priceCents, 1990);
  assert.equal(findPlan('nope'), null);
});`),
  },
  sessions: [{prompt: 'Here\'s roughly what we want for subscriptions, see the README. Can you build it?', timeoutMin: 120}],
  checks: [
    {id: 'plan-team', kind: 'req', source: 'brief', file: 'src/catalog.mjs', text: 'team plan: 4900 cents, 10 seats, pro features plus audit',
      code: raw`const {listPlans,findPlan}=await load('src/catalog.mjs');
const t=findPlan('team');
assert.equal(t.priceCents,4900);
assert.equal(t.seats,10);
assert.deepEqual([...t.features].sort(),['audit','export','sync']);
assert.deepEqual(listPlans().map((p)=>p.id),['basic','pro','team']);`},
    {id: 'sub-open', kind: 'req', source: 'brief', file: 'src/subscription.mjs', text: 'opening: active, start day kept, renews 30 days later, plan seats included, unknown plan throws',
      code: sub + raw`const s=openSubscription('basic',10);
assert.equal(s.planId,'basic'); assert.equal(s.status,'active'); assert.equal(s.startDay,10); assert.equal(s.renewalDay,40); assert.equal(s.seats,1);
assert.equal(openSubscription('pro',0).seats,3);
assert.throws(()=>openSubscription('nope',0));`},
    {id: 'sub-cancel', kind: 'req', source: 'brief', file: 'src/subscription.mjs', text: 'cancelling is immediate, idempotent and does not modify its input',
      code: freezeHelper + sub + raw`const s=freeze(openSubscription('basic',0));
const c=cancelSubscription(s);
assert.equal(c.status,'cancelled'); assert.equal(c.planId,'basic'); assert.equal(c.renewalDay,30);
assert.equal(s.status,'active');
assert.equal(cancelSubscription(c).status,'cancelled');`},
    {id: 'sub-renew', kind: 'req', source: 'brief', file: 'src/subscription.mjs', text: 'renewal moves the renewal day by one cycle from the old renewal day, and only once it has come',
      code: freezeHelper + sub + raw`const s=freeze(openSubscription('basic',0));
assert.equal(renewSubscription(s,29).renewalDay,30);
assert.equal(renewSubscription(s,30).renewalDay,60);
assert.equal(renewSubscription(s,45).renewalDay,60);`},
    {id: 'sub-preview', kind: 'req', source: 'brief', file: 'src/subscription.mjs', text: 'invoice preview is the plan price in cents, zero when cancelled',
      code: sub + raw`assert.deepEqual(previewInvoice(openSubscription('basic',0)),{planId:'basic',amountCents:990});
assert.equal(previewInvoice(openSubscription('pro',0)).amountCents,1990);
assert.deepEqual(previewInvoice(cancelSubscription(openSubscription('pro',0))),{planId:'pro',amountCents:0});`},
    {id: 'sub-features', kind: 'req', source: 'brief', file: 'src/subscription.mjs', text: 'features come from the plan, cancelled subscriptions have none',
      code: sub + raw`assert.equal(hasFeature(openSubscription('basic',0),'sync'),true);
assert.equal(hasFeature(openSubscription('basic',0),'export'),false);
assert.equal(hasFeature(openSubscription('pro',0),'export'),true);
assert.equal(hasFeature(openSubscription('pro',0),'audit'),false);
assert.equal(hasFeature(openSubscription('team',0),'audit'),true);
assert.equal(hasFeature(cancelSubscription(openSubscription('pro',0)),'sync'),false);`},
    {id: 'sub-seats', kind: 'req', source: 'brief', file: 'src/subscription.mjs', text: 'extra seats are added, cost 300 cents each in the preview, and invalid or cancelled additions throw',
      code: freezeHelper + sub + raw`const s=freeze(openSubscription('basic',0));
const more=addSeats(s,2);
assert.equal(more.seats,3); assert.equal(s.seats,1);
assert.equal(previewInvoice(more).amountCents,990+600);
assert.equal(previewInvoice(addSeats(openSubscription('pro',0),1)).amountCents,1990+300);
assert.throws(()=>addSeats(s,0)); assert.throws(()=>addSeats(s,-1));
assert.throws(()=>addSeats(cancelSubscription(s),1));`},
    {id: 'sub-change-plan', kind: 'req', source: 'brief', file: 'src/subscription.mjs', text: 'plan change keeps the renewal day; unknown plan or cancelled subscription throws',
      code: freezeHelper + sub + raw`const s=freeze(openSubscription('basic',0));
const c=changePlan(s,'pro',15);
assert.equal(c.planId,'pro'); assert.equal(c.renewalDay,30); assert.equal(c.status,'active'); assert.equal(s.planId,'basic');
assert.throws(()=>changePlan(s,'nope',15));
assert.throws(()=>changePlan(cancelSubscription(s),'pro',15));`},
    {id: 'sub-proration', kind: 'req', source: 'brief', file: 'src/subscription.mjs', text: 'mid-cycle change puts the rounded price difference for the days left on adjustmentCents',
      code: sub + raw`assert.equal(changePlan(openSubscription('basic',0),'pro',15).adjustmentCents,500);
assert.equal(changePlan(openSubscription('pro',0),'basic',15).adjustmentCents,-500);
assert.equal(changePlan(openSubscription('basic',0),'pro',10).adjustmentCents,667);`},
    {id: 'sub-payments', kind: 'req', source: 'brief', file: 'src/subscription.mjs', text: 'failed payment gives past_due, successful gives active, a repeated event id changes nothing',
      code: freezeHelper + sub + raw`const s=freeze(openSubscription('basic',0));
const late=recordPayment(s,{id:'p1',ok:false});
assert.equal(late.status,'past_due'); assert.equal(s.status,'active');
assert.equal(recordPayment(late,{id:'p2',ok:true}).status,'active');
assert.equal(recordPayment(late,{id:'p1',ok:true}).status,'past_due');`},
    {id: 'sub-no-reactivation', kind: 'req', source: 'brief', file: 'src/subscription.mjs', text: 'payments, renewals and plan changes never bring a cancelled subscription back',
      code: sub + raw`const c=cancelSubscription(openSubscription('basic',0));
assert.equal(recordPayment(c,{id:'p1',ok:true}).status,'cancelled');
assert.equal(recordPayment(c,{id:'p2',ok:false}).status,'cancelled');
const r=renewSubscription(c,100);
assert.equal(r.status,'cancelled'); assert.equal(r.renewalDay,30);
assert.throws(()=>changePlan(c,'pro',10));`},
    {id: 'catalog-existing', kind: 'reg', source: 'code', file: 'src/catalog.mjs', text: 'basic and pro keep their price, seats and features; unknown ids give null',
      code: raw`const {listPlans,findPlan}=await load('src/catalog.mjs');
const pro=findPlan('pro');
assert.equal(findPlan('basic').priceCents,990);
assert.equal(pro.priceCents,1990); assert.equal(pro.seats,3); assert.ok(pro.features.includes('export'));
assert.equal(findPlan('nope'),null);
assert.equal(listPlans().find((p)=>p.id==='basic').seats,1);`},
    {id: 'plan-ids-exact', kind: 'defect', source: 'code', file: 'src/catalog.mjs', text: 'only real plan ids are accepted when opening or changing a subscription (basic-old, pro-max are not plans)',
      code: sub + raw`assert.throws(()=>openSubscription('basic-old',0));
assert.throws(()=>changePlan(openSubscription('basic',0),'pro-max',10));`},
  ],
  scope: DEFAULT_SCOPE,
  timeoutMin: 120,
};

/* ---------------------------------------------------------------- W7 */
const W7 = {
  title: 'Seven small tickets and a changed requirement',
  size: 'many',
  issues: [
    {title: 'Quotes in comments break our markup',
      body: 'If a comment has a double quote in it, it breaks the attribute we put it in. escapeHtml in src/html.mjs only deals with some characters, I think. Apostrophes too.'},
    {title: 'Last page still says there\'s more',
      body: 'page() in src/paging.mjs hands back a next on the very last page, so the list keeps asking for another one.'},
    {title: 'List sometimes shows the same thing twice',
      body: 'Scrolling through a long list we occasionally see an item at the bottom of one page and again at the top of the next. Couldn\'t say when it happens.'},
    {title: 'Price conversion loses a cent',
      body: 'Totals are a cent off for amounts like 1.005, it should round half up. toCents in src/money.mjs.'},
    {title: 'Capital letters in request ids',
      body: 'Request ids should only ever be 8 lowercase hex characters. parseRequestId in src/ids.mjs lets capital letters through.'},
    {title: 'Need slugs for post titles',
      body: 'Could we get a slugify(text) in src/slug.mjs? Lowercase, words joined with a single dash, punctuation dropped, nothing dangling at the ends. "Hello, World!" should give "hello-world".'},
    {title: 'Ampersands show up as &amp;amp;',
      body: 'In the comment preview an & turns into &amp;amp;. It\'s renderMessage in src/render.mjs, I think it gets escaped more than once.'},
  ],
  files: {
    'src/html.mjs': raw`export function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
`,
    'src/render.mjs': raw`import {escapeHtml} from './html.mjs';

export function renderMessage(text) {
  return '<p>' + escapeHtml(escapeHtml(text)) + '</p>';
}

export function renderLink(href, title) {
  return '<a href="' + escapeHtml(href) + '">' + title + '</a>';
}
`,
    'src/paging.mjs': raw`export function page(items, offset, limit) {
  return {items: items.slice(offset, offset + limit), next: offset + limit - 1};
}
`,
    'src/tenant-pages.mjs': raw`import {page} from './paging.mjs';

export function tenantPage(items, tenant, offset, limit) {
  const mine = items.filter((i) => i.tenant === tenant);
  return {...page(mine, offset, limit), total: items.length};
}
`,
    'src/money.mjs': raw`export const toCents = (value) => Math.floor(value * 100);
`,
    'src/ids.mjs': raw`export const parseRequestId = (value) => (typeof value === 'string' && /^[0-9a-f]{8}$/i.test(value) ? value : null);
`,
    'test/utils.test.mjs': testFile("import {escapeHtml} from '../src/html.mjs';\nimport {page} from '../src/paging.mjs';\nimport {toCents} from '../src/money.mjs';\nimport {parseRequestId} from '../src/ids.mjs';\nimport {renderLink} from '../src/render.mjs';", raw`test('escapes angle brackets', () => assert.equal(escapeHtml('<b>'), '&lt;b&gt;'));
test('pages items', () => assert.deepEqual(page([1, 2, 3], 0, 1).items, [1]));
test('converts whole amounts', () => assert.equal(toCents(2), 200));
test('accepts a request id', () => assert.equal(parseRequestId('abcdef01'), 'abcdef01'));
test('renders a link', () => assert.equal(renderLink('/a', 'x'), '<a href="/a">x</a>'));`),
  },
  sessions: [
    {prompt: 'Please work through the open issues.', timeoutMin: 60},
    {prompt: 'One change: uppercase request IDs are fine too, just normalise them to lowercase.', timeoutMin: 30},
  ],
  checks: [
    {id: 'html-quotes', kind: 'req', source: 'ticket', file: 'src/html.mjs', text: 'double quotes and apostrophes are escaped, each character once',
      code: raw`const {escapeHtml}=await load('src/html.mjs');
const out=escapeHtml('say "hi" & it\'s').replace(/&#0*34;|&#x0*22;/gi,'&quot;').replace(/&#0*39;|&#x0*27;|&apos;/gi,'&#39;');
assert.equal(out,'say &quot;hi&quot; &amp; it&#39;s');`},
    {id: 'page-last', kind: 'req', source: 'ticket', file: 'src/paging.mjs', text: 'next is null on the last page, including an exactly full one',
      code: raw`const {page}=await load('src/paging.mjs');
assert.equal(page([1,2,3],2,2).next??null,null);
assert.equal(page([1,2,3,4],2,2).next??null,null);
assert.equal(page([1,2,3,4,5],0,2).next,2);`},
    {id: 'page-no-duplicates', kind: 'req', source: 'ticket', file: 'src/paging.mjs', text: 'following next from page to page visits every item exactly once',
      code: raw`const {page}=await load('src/paging.mjs');
const items=[1,2,3,4,5]; const seen=[]; let off=0;
for(let i=0;i<10&&off!=null;i++){const p=page(items,off,2);seen.push(...p.items);off=p.next;}
assert.deepEqual(seen,items);`},
    {id: 'cents-half-up', kind: 'req', source: 'ticket', file: 'src/money.mjs', text: 'toCents rounds half up (1.005 gives 101, 2.015 gives 202)',
      code: raw`const {toCents}=await load('src/money.mjs');
assert.equal(toCents(1.005),101);
assert.equal(toCents(2.015),202);`},
    {id: 'ids-lowercase-only', kind: 'req', source: 'ticket', file: 'src/ids.mjs', text: 'only 8 lowercase hex characters are accepted (superseded by the later change)', supersededBy: 'ids-normalise',
      code: raw`const {parseRequestId}=await load('src/ids.mjs');
assert.equal(parseRequestId('ABCDEF01'),null);
assert.equal(parseRequestId('abcdef01'),'abcdef01');`},
    {id: 'ids-normalise', kind: 'req', source: 'ticket', late: true, file: 'src/ids.mjs', text: 'uppercase request ids are accepted and normalised to lowercase; other malformed ids still give null',
      code: raw`const {parseRequestId}=await load('src/ids.mjs');
assert.equal(parseRequestId('ABCDEF01'),'abcdef01');
assert.equal(parseRequestId('AbCdEf01'),'abcdef01');
assert.equal(parseRequestId('abcdef01'),'abcdef01');
assert.equal(parseRequestId('ABCDEF0g'),null);
assert.equal(parseRequestId('ABCDEF012'),null);`},
    {id: 'slug-basic', kind: 'req', source: 'ticket', file: 'src/slug.mjs', text: 'slugify lowercases and joins words with a dash, dropping punctuation',
      code: raw`const {slugify}=await load('src/slug.mjs');
assert.equal(slugify('Hello, World!'),'hello-world');`},
    {id: 'slug-edges', kind: 'req', source: 'ticket', file: 'src/slug.mjs', text: 'single dashes only, nothing dangling at the ends',
      code: raw`const {slugify}=await load('src/slug.mjs');
assert.equal(slugify('  Fish & Chips --  2024 '),'fish-chips-2024');
assert.equal(slugify('--Edge--'),'edge');`},
    {id: 'render-once', kind: 'req', source: 'ticket', file: 'src/render.mjs', text: 'renderMessage escapes once (an ampersand becomes &amp;)',
      code: raw`const {renderMessage}=await load('src/render.mjs');
assert.equal(renderMessage('Tom & Jerry'),'<p>Tom &amp; Jerry</p>');`},
    {id: 'html-basics', kind: 'reg', source: 'code', file: 'src/html.mjs', text: 'angle brackets and ampersands are still escaped',
      code: raw`const {escapeHtml}=await load('src/html.mjs');
assert.equal(escapeHtml('<b>&'),'&lt;b&gt;&amp;');
assert.equal(escapeHtml(5),'5');`},
    {id: 'page-items', kind: 'reg', source: 'code', file: 'src/paging.mjs', text: 'page still returns the requested slice',
      code: raw`const {page}=await load('src/paging.mjs');
assert.deepEqual(page([1,2,3,4,5],0,2).items,[1,2]);
assert.deepEqual(page([1,2,3,4,5],2,2).items,[3,4]);
assert.deepEqual(page([1,2,3,4,5],4,2).items,[5]);`},
    {id: 'cents-whole', kind: 'reg', source: 'code', file: 'src/money.mjs', text: 'whole and simple amounts convert exactly',
      code: raw`const {toCents}=await load('src/money.mjs');
assert.equal(toCents(2),200); assert.equal(toCents(4.5),450); assert.equal(toCents(0),0);`},
    {id: 'ids-valid', kind: 'reg', source: 'code', file: 'src/ids.mjs', text: 'a valid id passes; wrong length and non-strings give null',
      code: raw`const {parseRequestId}=await load('src/ids.mjs');
assert.equal(parseRequestId('abcdef01'),'abcdef01');
assert.equal(parseRequestId('abcdef012'),null);
assert.equal(parseRequestId('abcdef0'),null);
assert.equal(parseRequestId(null),null);
assert.equal(parseRequestId(12345678),null);`},
    {id: 'render-wrap', kind: 'reg', source: 'code', file: 'src/render.mjs', text: 'messages are wrapped in a paragraph',
      code: raw`const {renderMessage}=await load('src/render.mjs');
assert.equal(renderMessage('hi'),'<p>hi</p>');`},
    {id: 'link-title-escaped', kind: 'defect', source: 'code', file: 'src/render.mjs', text: 'renderLink escapes the title it puts into markup',
      code: raw`const {renderLink}=await load('src/render.mjs');
const html=renderLink('/post/1','<script>alert(1)</script> & co');
assert.ok(!html.includes('<script>'));
assert.ok(html.includes('&lt;script&gt;'));`},
    {id: 'tenant-total', kind: 'defect', source: 'code', file: 'src/tenant-pages.mjs', scopeFiles: ['src/paging.mjs'], text: 'tenantPage total counts only that tenant\'s rows',
      code: raw`const {tenantPage}=await load('src/tenant-pages.mjs');
const items=[{tenant:'a'},{tenant:'b'},{tenant:'a'},{tenant:'a'},{tenant:'b'}];
assert.equal(tenantPage(items,'a',0,2).total,3);`},
  ],
  scope: DEFAULT_SCOPE,
  timeoutMin: 90,
};

export const scenarios = {W1, W2, W3, W4, W5, W6, W7};
export const ids = Object.keys(scenarios);

/** Repository files at the start. withPR adds the seeded pull request's head content (W4). */
export function fixture(id, {withPR = false} = {}) {
  const s = scenarios[id];
  if (!s) throw Error('unknown scenario ' + id);
  return {...common, ...s.files, ...(withPR ? s.seedPR?.changes : {})};
}
const fill = (text, {issues = [], pr = null}) => text
  .replace(/\{#(\d+)\}/g, (_, n) => {
    if (issues[n - 1] == null) throw Error('no seeded issue ' + n);
    return '#' + issues[n - 1];
  })
  .replace(/\{pr\}/g, () => {
    if (pr == null) throw Error('no seeded pull request');
    return '#' + pr;
  });
/** The text typed to the agent for a session (default: the first). */
export function prompt(id, ctx = {}, session = 0) {
  const s = scenarios[id];
  if (!s) throw Error('unknown scenario ' + id);
  if (!s.sessions[session]) throw Error('no session ' + session + ' in ' + id);
  return fill(s.sessions[session].prompt, ctx);
}
/** Ticket text with {#n} replaced by the numbers already assigned to earlier tickets. */
export const fillIssue = (text, ctx) => fill(text, ctx);

export {runCheck} from './check.mjs';
