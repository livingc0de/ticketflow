// Extra cross-module requirements for workflow benchmarks. W1 remains a deliberate low-cost control.
// Kept separate so the original fixture APIs and hidden fixture tests stay easy to understand.
const additions = {
  "W2": {
    "goal": "One financial-correctness ticket: repair the shared half-cent rounding defect and propagate exact cents through invoice lines, refunds, VAT, settlement, payment replay, and reconciliation. Preserve existing exports; test edge rounding, duplicate payment IDs, and immutable inputs. Deliver one reviewed, verified PR.",
    "issues": [
      "Fix the shared half-cent bug across invoice/refunds. Add settlement with VAT in basis points (round half up to cents after subtracting refunds), idempotent payment ledger keyed by event ID, and reconciliation of outstanding balance. Keep money as numeric cents-compatible decimal values, handle repeated webhook events without double counting, preserve input immutability, add cross-module regression tests."
    ],
    "files": {
      "src/settlement.mjs": "import {invoiceLine} from './invoice.mjs';\nimport {refundLine} from './refund.mjs';\nexport function settle(items, refunds, vatBps=1900) {\n  const subtotal=items.reduce((n,x)=>n+invoiceLine(x.price,x.qty),0);\n  const refunded=refunds.reduce((n,x)=>n+refundLine(x.price,x.qty),0);\n  const taxable=Math.max(0,subtotal-refunded);\n  const vat=Math.floor(taxable*vatBps/10000*100)/100;\n  return {subtotal,refunded,vat,total:taxable+vat};\n}\n",
      "src/ledger.mjs": "export function applyPayment(state,event) {\n  return {balance:state.balance+event.amount,seen:[...state.seen,event.id]};\n}\n",
      "src/reconcile.mjs": "import {settle} from './settlement.mjs';\nexport function reconcile(items,refunds,payments,vatBps=1900) {\n  const bill=settle(items,refunds,vatBps);\n  const paid=payments.reduce((sum,e)=>sum+e.amount,0);\n  return {...bill,outstanding:Math.max(0,bill.total-paid)};\n}\n"
    },
    "hidden": "const {settle}=await import(pathToFileURL(join(dir,'src/settlement.mjs')).href);\nconst {applyPayment}=await import(pathToFileURL(join(dir,'src/ledger.mjs')).href);\nconst {reconcile}=await import(pathToFileURL(join(dir,'src/reconcile.mjs')).href);\nassert.deepEqual(settle([{price:10,qty:1}], [{price:2,qty:1}],1000),{subtotal:10,refunded:2,vat:0.8,total:8.8});\nassert.equal(settle([{price:1.005,qty:1}],[],0).total,1.01);\nconst p0={balance:0,seen:[]}, pay={id:'evt-1',amount:4};\nconst p1=applyPayment(p0,pay);\nassert.deepEqual(p0,{balance:0,seen:[]});\nassert.deepEqual(p1,{balance:4,seen:['evt-1']});\nassert.deepEqual(applyPayment(p1,pay),p1);\nassert.equal(reconcile([{price:10,qty:1}],[{price:2,qty:1}],[pay,pay],1000).outstanding,4.8);"
  },
  "W3": {
    "goal": "Deliver three dependent tenant-isolation changes: secure lookups, tenant-filtered pagination, then integrated API, CSV export, batch retrieval and audit. The integration must not leak colliding IDs, cross-tenant page data or CSV content; test dependency order and acceptance before shipping.",
    "issues": [
      "Secure tenant-specific order lookup with colliding IDs and missing records; add a regression test that denies cross-tenant access.",
      "Correct pagination boundary and next-cursor behavior, including empty pages; add edge-case tests.",
      "Integrate tenant-safe lookup and pagination with order API, tenant-scoped CSV export, batch lookup and auditable access decision. Depends on lookup and pagination fixes. Verify all outputs exclude other tenants."
    ],
    "files": {
      "src/export.mjs": "export function exportTenantCsv(orders,tenant) {\n return ['id,tenant',...orders.map(o=>o.id+','+o.tenant)].join('\\n');\n}\n",
      "src/batch.mjs": "import {lookupOrder} from './store.mjs';\nexport function getTenantBatch(orders,tenant,ids) {\n return ids.map(id=>lookupOrder(orders,id)).filter(Boolean);\n}\n",
      "src/access.mjs": "import {lookupOrder} from './store.mjs';\nexport function authorizeAndAudit(orders,tenant,id) {\n const found=lookupOrder(orders,id);\n return {found,audit:{tenant,id,granted:found!==null}};\n}\n"
    },
    "hidden": "const {exportTenantCsv}=await import(pathToFileURL(join(dir,'src/export.mjs')).href);\nconst {getTenantBatch}=await import(pathToFileURL(join(dir,'src/batch.mjs')).href);\nconst {authorizeAndAudit}=await import(pathToFileURL(join(dir,'src/access.mjs')).href);\nconst multi=[{id:'1',tenant:'a'},{id:'1',tenant:'b'},{id:'x,2',tenant:'a'}];\nassert.deepEqual(getTenantBatch(multi,'b',['1','x,2']),[multi[1]]);\nassert.deepEqual(authorizeAndAudit(multi,'b','x,2'),{found:null,audit:{tenant:'b',id:'x,2',granted:false}});\nassert.equal(exportTenantCsv(multi,'a'),'id,tenant\\n1,a\\n\"x,2\",a');\nassert.equal(exportTenantCsv(multi,'c'),'id,tenant');"
  },
  "W4": {
    "goal": "Continue and repair the existing failing payment webhook PR, not a replacement PR. Restore exactly-once application, immutable balances, valid batch replay and idempotent reversals. Resolve the seeded review finding, check CI and exact head, then merge safely.",
    "issues": [
      "Repair the existing payment webhook PR without replacing it: duplicate events must not change balances, incoming events need validated finite amounts, batch processing must preserve immutability, reversals must be idempotent, and the blocking review plus red CI must be addressed before merge."
    ],
    "files": {
      "src/webhook-batch.mjs": "import {applyEvent} from './webhook.mjs';\nexport function processBatch(state,events) {\n return events.reduce((s,e)=>applyEvent(s,e),state);\n}\n",
      "src/reversal.mjs": "export function reverseEvent(state,event) {\n return {balance:state.balance-event.delta,seen:[...state.seen,'reverse:'+event.id]};\n}\n"
    },
    "hidden": "const {processBatch}=await import(pathToFileURL(join(dir,'src/webhook-batch.mjs')).href);\nconst {reverseEvent}=await import(pathToFileURL(join(dir,'src/reversal.mjs')).href);\nconst start={balance:10,seen:[]};\nconst a={id:'e1',delta:5},b={id:'e2',delta:-2};\nconst processed=processBatch(start,[a,a,b]);\nassert.deepEqual(start,{balance:10,seen:[]});\nassert.deepEqual(processed,{balance:13,seen:['e1','e2']});\nassert.throws(()=>processBatch(start,[{id:'bad',delta:NaN}]));\nconst reversed=reverseEvent(processed,a);\nassert.equal(reversed.balance,8);\nassert.deepEqual(reverseEvent(reversed,a),reversed);"
  },
  "W5": {
    "goal": "Implement a resilient event-sourced order transition flow with immutable state, deduplicated event IDs, legal transitions, deterministic replay and resumable snapshots. Delivery will be interrupted after work is pushed; recover from GitHub without duplicate PRs or lost progress.",
    "issues": [
      "Implement legal immutable order transitions and replay, including duplicate/out-of-order events. Add checkpoint(state,events,count) and resume(checkpoint,events) APIs with stable cursor positions and tests. Ship through a reviewed PR, and after an interruption resume from remote state without creating a second PR."
    ],
    "files": {
      "src/events.mjs": "import {transition} from './orders.mjs';\nexport function replay(initial,events){return events.reduce((s,e)=>transition(s,e),initial)}\n",
      "src/snapshot.mjs": "import {replay} from './events.mjs';\nexport function checkpoint(initial,events,count){\n return {cursor:0,state:replay(initial,events)};\n}\nexport function resume(check,events){return replay(check.state,events)}\n"
    },
    "hidden": "const {replay}=await import(pathToFileURL(join(dir,'src/events.mjs')).href);\nconst {checkpoint,resume}=await import(pathToFileURL(join(dir,'src/snapshot.mjs')).href);\nconst initial={status:'created',history:[]};\nconst events=[{id:'p',to:'paid'},{id:'p',to:'shipped'},{id:'s',to:'shipped'}];\nconst full=replay(initial,events);\nassert.deepEqual(full,{status:'shipped',history:['p','s']});\nassert.deepEqual(initial,{status:'created',history:[]});\nconst saved=checkpoint(initial,events,1);\nassert.deepEqual(saved,{cursor:1,state:{status:'paid',history:['p']}});\nassert.deepEqual(resume(saved,events),full);\nassert.throws(()=>checkpoint(initial,events,4));"
  },
  "W6": {
    "goal": "Start from the product request without seeded issues: choose a practical architecture, decompose cross-cutting work with dependencies, and deliver a coherent subscription service including pricing, immutable lifecycle, entitlements, seat quotas, plan switching and payment-event recovery. Use the native workflow of each arm; no framework-specific artifacts are required.",
    "issues": [],
    "files": {
      "src/entitlements.mjs": "export function hasAccess(state,capability){\n return state.status==='active';\n}\n",
      "src/seats.mjs": "export function reserveSeat(state,seatId) {\n return {...state,seats:[...(state.seats||[]),seatId]};\n}\n",
      "src/change-plan.mjs": "export function changePlan(state,planId) {\n return {...state,planId};\n}\n",
      "src/webhook.mjs": "export function applyBillingNotice(state,event){\n return {...state,status:'active'};\n}\n"
    },
    "hidden": "const {hasAccess}=await import(pathToFileURL(join(dir,'src/entitlements.mjs')).href);\nconst {reserveSeat}=await import(pathToFileURL(join(dir,'src/seats.mjs')).href);\nconst {changePlan}=await import(pathToFileURL(join(dir,'src/change-plan.mjs')).href);\nconst {applyBillingNotice}=await import(pathToFileURL(join(dir,'src/webhook.mjs')).href);\nconst basic=mod.openSubscription('basic',1),pro=mod.openSubscription('pro',1);\nassert.equal(hasAccess(basic,'reports'),false);\nassert.equal(hasAccess(pro,'reports'),true);\nassert.equal(hasAccess(mod.cancelSubscription(pro),'dashboard'),false);\nlet seats=reserveSeat(basic,'u1');seats=reserveSeat(seats,'u1');\nassert.deepEqual(seats.seats,['u1']);\nseats=reserveSeat(reserveSeat(seats,'u2'),'u3');\nassert.throws(()=>reserveSeat(seats,'u4'));\nconst switched=changePlan(basic,'pro');\nassert.equal(switched.planId,'pro');\nassert.equal(switched.renewalDay,basic.renewalDay);\nassert.throws(()=>changePlan(basic,'illegal'));\nassert.equal(changePlan(mod.cancelSubscription(basic),'pro').status,'cancelled');\nconst failed=applyBillingNotice(basic,{id:'f',kind:'payment_failed'});\nassert.equal(failed.status,'past_due');\nassert.deepEqual(applyBillingNotice(failed,{id:'f',kind:'payment_received'}),failed);\nassert.equal(applyBillingNotice(failed,{id:'r',kind:'payment_received'}).status,'active');\nassert.equal(applyBillingNotice(mod.cancelSubscription(basic),{id:'r',kind:'payment_received'}).status,'cancelled');",
    "readme": "\nDelivery also includes entitlement checks, seat quotas and payment-event recovery:\n- Export hasAccess(state,capability) from src/entitlements.mjs: only active subscriptions; 'reports' requires pro, 'dashboard' supports either plan.\n- Export reserveSeat(state,seatId) from src/seats.mjs: immutable seats array; basic allows 3 distinct seats, pro 10; duplicates are idempotent, over-limit throws.\n- Export changePlan(state,planId) from src/change-plan.mjs: validate against catalog, preserve renewalDay and status, never reactivate cancelled subscriptions.\n- Export applyBillingNotice(state,event) from src/webhook.mjs: deduplicate event IDs using seenEvents. 'payment_failed' moves active to past_due, 'payment_received' restores past_due to active; cancelled is never reactivated.\n- Preserve existing public API, avoid added dependencies and cover cross-module failures with behavioral tests.\n"
  },
  "W7": {
    "goal": "Coordinate four independent existing issues. Each includes an integration boundary beyond a single utility: safe HTML rendering, tenant-filtered pagination, precise refund cents, and strict request-ID parsing. Deliver correct reviewed changes without duplicate effort or unnecessary cross-ticket coupling; parallelism is optional.",
    "issues": [
      "Implement escapeHtml and renderMessage(value) in src/render.mjs; escape &, <, >, quotes and apostrophes once, never interpolate unescaped user text into HTML. Include XSS-shaped regression cases.",
      "Implement validated page(items,offset,limit) and tenantPage(items,tenant,offset,limit) in src/tenant-pages.mjs; filter before paginating, enforce valid offsets/limits and return null at the end.",
      "Implement toCents(value) with half-up rounding to integer cents and refundTotal(lines) in src/refunds.mjs; quantities and adjustments must not double-round or lose cents.",
      "Implement parseRequestId(value) (exactly eight lowercase hex digits) and requestIdFromHeaders(headers) in src/requests.mjs; reject missing, malformed or wrong-case IDs without coercing nonstrings."
    ],
    "files": {
      "src/render.mjs": "import {escapeHtml} from './html.mjs';\nexport const renderMessage=value=>'<p>'+String(value)+'</p>';\n",
      "src/tenant-pages.mjs": "import {page} from './paging.mjs';\nexport const tenantPage=(items,tenant,offset,limit)=>page(items,offset,limit);\n",
      "src/refunds.mjs": "import {toCents} from './money.mjs';\nexport function refundTotal(lines){return lines.reduce((n,x)=>n+toCents(x.price)*x.qty,0)}\n",
      "src/requests.mjs": "import {parseRequestId} from './ids.mjs';\nexport function requestIdFromHeaders(headers){return parseRequestId(headers['x-request-id'])}\n"
    },
    "hidden": "const {renderMessage}=await import(pathToFileURL(join(dir,'src/render.mjs')).href);\nconst {tenantPage}=await import(pathToFileURL(join(dir,'src/tenant-pages.mjs')).href);\nconst {refundTotal}=await import(pathToFileURL(join(dir,'src/refunds.mjs')).href);\nconst {requestIdFromHeaders}=await import(pathToFileURL(join(dir,'src/requests.mjs')).href);\nassert.equal(renderMessage('<img src=\"x\" onerror=\"bad\">'),'<p>&lt;img src=&quot;x&quot; onerror=&quot;bad&quot;&gt;</p>');\nconst items=[{tenant:'a',id:1},{tenant:'b',id:2},{tenant:'a',id:3}];\nassert.deepEqual(tenantPage(items,'a',1,1),{items:[items[2]],next:null});\nassert.deepEqual(tenantPage(items,'b',0,1),{items:[items[1]],next:null});\nassert.equal(refundTotal([{price:1.005,qty:2},{price:2.015,qty:1}]),404);\nassert.equal(requestIdFromHeaders({'x-request-id':'abcdef01'}),'abcdef01');\nassert.equal(requestIdFromHeaders({'x-request-id':'ABCDEF01'}),null);\nassert.equal(requestIdFromHeaders({'x-request-id':123}),null);"
  }
}

export function enhanceScenarios(scenarios) {
  for (const [id,extra] of Object.entries(additions)) {
    const scenario=scenarios[id]
    scenario.title += ' (cross-module)'
    scenario.goal=extra.goal
    scenario.issues=extra.issues
    Object.assign(scenario.files,extra.files)
    if (extra.readme) scenario.files['README.md'] += extra.readme
    scenario.hidden.code += '\n' + extra.hidden + '\n'
  }
}
