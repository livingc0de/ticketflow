/**
 * Workflow benchmark fixtures. The agent sees only files and issue bodies, never
 * hidden acceptance cases. All arms receive identical product requirements.
 */
const source = (lines) => lines.join('\n') + '\n';
const common = {
  'package.json': JSON.stringify({name:'workflow-benchmark-fixture',private:true,type:'module',scripts:{test:'node --test test/*.test.mjs'}}, null, 2) + '\n',
  '.github/workflows/bench.yml': source([
    'name: bench',
    'on: [push, pull_request]',
    'jobs:',
    '  tests:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    "          node-version: '22'",
    '      - run: npm test'
  ]),
  '.gitignore': 'node_modules/\n',
};
export const scenarios = {
  W1: {
    title: 'Small, proportional CSV feature',
    issues: ['Add CSV export to the report formatter, retaining its existing TSV output. Handle embedded commas, quotation marks and newlines, and preserve column order.'],
    files: {
      'src/report.mjs': source([
        "export const columns = ['name', 'total'];",
        "export function tsv(rows) {",
        "  return [columns.join('\\t'), ...rows.map(r => columns.map(k => r[k]).join('\\t'))].join('\\n');",
        "}"
      ]),
      'test/report.test.mjs': source([
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import {tsv} from '../src/report.mjs';",
        "test('TSV format remains stable', () => assert.equal(tsv([{name:'A',total:2}]), 'name\\ttotal\\nA\\t2'));"
      ])
    },
    goal: 'Implement CSV export. Keep the existing TSV behavior. Deliver a reviewed, CI-verified, merged pull request without unnecessary dependencies.',
    hidden: {
      exports: ['csv', 'tsv'],
      code: source([
        "assert.equal(mod.tsv([{name:'A',total:2}]), 'name\\ttotal\\nA\\t2');",
        "assert.equal(mod.csv([{name:'A,B',total:2}]), 'name,total\\n\"A,B\",2');",
        "assert.equal(mod.csv([{name:'A\"B',total:1},{name:'line\\nbreak',total:0}]), 'name,total\\n\"A\"\"B\",1\\n\"line\\nbreak\",0');",
        "assert.equal(mod.csv([]), 'name,total');"
      ]),
      module:'src/report.mjs'
    }
  },
  W2: {
    title: 'Cross-module money correctness',
    issues: ['Fix half-cent rounding across invoice calculation and refunds, using one shared money helper. Add a regression test that fails on the original rounding behavior.'],
    files: {
      'src/money.mjs': source([
        'export const toCents = amount => Math.floor(amount * 100) / 100;'
      ]),
      'src/invoice.mjs': source([
        "import {toCents} from './money.mjs';",
        "export const invoiceLine = (price, qty) => toCents(price * qty);"
      ]),
      'src/refund.mjs': source([
        "import {toCents} from './money.mjs';",
        "export const refundLine = (price, qty) => toCents(price * qty);"
      ]),
      'test/money.test.mjs': source([
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import {invoiceLine} from '../src/invoice.mjs';",
        "test('ordinary amount', () => assert.equal(invoiceLine(2,2),4));"
      ])
    },
    goal:'Repair invoice/refund rounding at the shared source, with meaningful regression tests, then deliver a reviewed, CI-verified, merged PR.',
    hidden:{
      module:'src/invoice.mjs',
      code:source([
        "const refund = await import(pathToFileURL(join(dir,'src/refund.mjs')).href);",
        "const money = await import(pathToFileURL(join(dir,'src/money.mjs')).href);",
        "assert.equal(mod.invoiceLine(1.005,1), 1.01);",
        "assert.equal(refund.refundLine(1.005,1), 1.01);",
        "assert.equal(mod.invoiceLine(0.995,1), 1);",
        "assert.equal(refund.refundLine(2.015,1), 2.02);",
        "assert.equal(money.toCents(1.005), 1.01);"
      ])
    }
  },
  W3: {
    title:'Three dependent changes with tenant boundary',
    issues:[
      'Build a tenant-safe order API covering tenant-scoped lookup, paginated listings and integrated API behavior. Break the initiative into appropriately scoped and ordered implementation tasks before delivery.'
    ],
    files:{
      'src/store.mjs': source([
        "export function lookupOrder(orders,id) { return orders.find(o=>o.id===id) ?? null; }"
      ]),
      'src/paging.mjs': source([
        'export function page(rows,start,size) {',
        '  return {items:rows.slice(start,start+size),next:start+size};',
        '}'
      ]),
      'src/api.mjs': source([
        "import {lookupOrder} from './store.mjs';",
        "import {page} from './paging.mjs';",
        "export function listOrders(orders,tenant,start,size) { return page(orders,start,size); }",
        "export function getOrder(orders,tenant,id) { return lookupOrder(orders,id); }"
      ]),
      'test/api.test.mjs':source([
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import {listOrders} from '../src/api.mjs';",
        "test('basic listing', () => assert.equal(listOrders([{tenant:'a',id:1}], 'a',0,10).items.length,1));"
      ])
    },
    goal:'Decompose the initiative into suitable independently tracked work, handle dependencies, and deliver tenant-safe lookup, pagination and API integration through reviewed and verified PRs.',
    hidden:{
      module:'src/api.mjs',
      code:source([
        "const orders=[{id:1,tenant:'a'},{id:1,tenant:'b'},{id:2,tenant:'a'},{id:3,tenant:'b'}];",
        "assert.deepEqual(mod.getOrder(orders,'a',1),orders[0]);",
        "assert.equal(mod.getOrder(orders,'c',1),null);",
        "assert.deepEqual(mod.listOrders(orders,'a',0,1),{items:[orders[0]],next:1});",
        "assert.deepEqual(mod.listOrders(orders,'a',1,1),{items:[orders[2]],next:null});",
        "assert.deepEqual(mod.listOrders(orders,'b',0,5),{items:[orders[1],orders[3]],next:null});"
      ])
    }
  },
  W4: {
    title:'Repair a failing PR and address review feedback',
    issues:['Fix the incoming payment webhook PR: duplicate deliveries must not change balances twice, state must remain immutable, and the review finding and failing CI must be resolved before merging.'],
    files:{
      'src/webhook.mjs':source([
        'export function applyEvent(state,event) {',
        "  if (state.seen.includes(event.id)) return state;",
        '  return {balance:state.balance+event.delta,seen:[...state.seen,event.id]};',
        '}'
      ]),
      'test/webhook.test.mjs':source([
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import {applyEvent} from '../src/webhook.mjs';",
        "test('duplicate events do not apply twice',()=>{const s={balance:0,seen:[]}, e={id:'a',delta:2};assert.equal(applyEvent(applyEvent(s,e),e).balance,2)});"
      ])
    },
    seedBrokenPR:{
      branch:'bench/broken-webhook',
      changes:{
        'src/webhook.mjs':source([
          'export function applyEvent(state,event) {',
          '  return {balance:state.balance+event.delta,seen:[...state.seen,event.id]};',
          '}'
        ])
      },
      review:'Blocking review finding: src/webhook.mjs applies an already-seen event again. Preserve the idempotency guard and run the failing test before merging.'
    },
    goal:'Continue the existing failing PR. Repair it, address its review finding, verify the new head and merge only when green.',
    hidden:{
      module:'src/webhook.mjs',
      code:source([
        "const s={balance:10,seen:[]},e={id:'x',delta:5};",
        "const once=mod.applyEvent(s,e);",
        "assert.deepEqual(s,{balance:10,seen:[]});",
        "assert.deepEqual(once,{balance:15,seen:['x']});",
        "assert.deepEqual(mod.applyEvent(once,e),once);"
      ])
    }
  },
  W5:{
    title:'Interrupted delivery and resume from remote state',
    issues:['Add an immutable state transition helper that validates legal order states, deduplicates event IDs, and records an audit history entry per accepted event. Ship and verify the result in a PR.'],
    files:{
      'src/orders.mjs':source([
        'export function transition(state,event) {',
        '  return {status:event.to,history:[...state.history,event.id]};',
        '}'
      ]),
      'test/orders.test.mjs':source([
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import {transition} from '../src/orders.mjs';",
        "test('accepts created to paid',()=>assert.equal(transition({status:'created',history:[]},{id:'a',to:'paid'}).status,'paid'));"
      ])
    },
    goal:'Implement the order state transition rules, then deliver a reviewed, verified PR. This task may be interrupted; resume from existing GitHub state instead of duplicating work.',
    hidden:{
      module:'src/orders.mjs',
      code:source([
        "const s={status:'created',history:[]};",
        "const paid=mod.transition(s,{id:'e1',to:'paid'});",
        "assert.equal(paid.status,'paid');",
        "assert.deepEqual(s,{status:'created',history:[]});",
        "assert.deepEqual(mod.transition(paid,{id:'e1',to:'shipped'}),paid);",
        "assert.equal(mod.transition(paid,{id:'e2',to:'shipped'}).status,'shipped');",
        "assert.deepEqual(mod.transition(s,{id:'e3',to:'shipped'}),s);",
        "assert.deepEqual(mod.transition(paid,{id:'e4',to:'created'}),paid);",
        "assert.deepEqual(paid.history,['e1']);"
      ])
    }
  }
};
export const ids = Object.keys(scenarios);
export function fixture(id) {
  const s=scenarios[id];
  if(!s) throw Error('unknown scenario '+id);
  return {...common,...s.files};
}
export function prompt(id, repo, issueNumbers, prNumber=null) {
  const s=scenarios[id];
  const items=issueNumbers.map((n,i)=>'#'+n+': '+s.issues[i]).join('\n');
  return [
    'You are working on a disposable evaluation repository: '+repo+'.',
    'Goal: '+s.goal,
    'Existing issue(s):\n'+items,
    prNumber ? 'An existing pull request needs repair: #'+prNumber+'. Continue that PR.' : 'No pull request has been started yet.',
    'Use your available development approach and any native skills to complete the full delivery.',
    'Use GitHub issues for tracking, implement the code, run appropriate tests, review the actual changes, and deliver through a pull request.',
    'Merge only after the latest-head automated checks are green and review findings are resolved.',
    'Never bypass protections or claim checks ran when they did not. Do not ask for owner approval merely to create a routine PR.',
    'Finish with the PR URL and any unverified items. Do not modify other repositories.',
  ].join('\n\n');
}
