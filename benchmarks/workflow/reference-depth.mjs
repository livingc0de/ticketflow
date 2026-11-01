// Known-good additions for fixture smoke tests; never copied into benchmark repositories.
export const depthReference = {
  "W2": {
    "src/settlement.mjs": "import {invoiceLine} from './invoice.mjs';\nimport {refundLine} from './refund.mjs';\nimport {toCents} from './money.mjs';\nexport function settle(items,refunds,vatBps=1900) {\n const subtotal=toCents(items.reduce((n,x)=>n+invoiceLine(x.price,x.qty),0));\n const refunded=toCents(refunds.reduce((n,x)=>n+refundLine(x.price,x.qty),0));\n const taxable=toCents(Math.max(0,subtotal-refunded));\n const vat=toCents(taxable*vatBps/10000);\n return {subtotal,refunded,vat,total:toCents(taxable+vat)};\n}\n",
    "src/ledger.mjs": "export function applyPayment(state,event) {\n return state.seen.includes(event.id)?state:{balance:state.balance+event.amount,seen:[...state.seen,event.id]};\n}\n",
    "src/reconcile.mjs": "import {settle} from './settlement.mjs';\nimport {applyPayment} from './ledger.mjs';\nimport {toCents} from './money.mjs';\nexport function reconcile(items,refunds,payments,vatBps=1900){\n const bill=settle(items,refunds,vatBps);\n const paid=payments.reduce((state,e)=>applyPayment(state,e),{balance:0,seen:[]}).balance;\n return {...bill,outstanding:toCents(Math.max(0,bill.total-paid))};\n}\n"
  },
  "W3": {
    "src/export.mjs": "const esc=v=>{const x=String(v);return /[\",\\r\\n]/.test(x)?'\"'+x.replaceAll('\"','\"\"')+'\"':x};\nexport function exportTenantCsv(orders,tenant){\n return ['id,tenant',...orders.filter(o=>o.tenant===tenant).map(o=>[o.id,o.tenant].map(esc).join(','))].join('\\n');\n}\n",
    "src/batch.mjs": "import {getOrder} from './api.mjs';\nexport function getTenantBatch(orders,tenant,ids) {\n return ids.map(id=>getOrder(orders,tenant,id)).filter(Boolean);\n}\n",
    "src/access.mjs": "import {getOrder} from './api.mjs';\nexport function authorizeAndAudit(orders,tenant,id) {\n const found=getOrder(orders,tenant,id);\n return {found,audit:{tenant,id,granted:found!==null}};\n}\n"
  },
  "W4": {
    "src/webhook-batch.mjs": "import {applyEvent} from './webhook.mjs';\nexport function processBatch(state,events) {\n if(!events.every(e=>typeof e.id==='string'&&e.id.length>0&&Number.isFinite(e.delta)))throw Error('invalid event');\n return events.reduce((s,e)=>applyEvent(s,e),state);\n}\n",
    "src/reversal.mjs": "import {applyEvent} from './webhook.mjs';\nexport const reverseEvent=(state,event)=>applyEvent(state,{id:'reverse:'+event.id,delta:-event.delta});\n"
  },
  "W5": {
    "src/events.mjs": "import {transition} from './orders.mjs';\nexport function replay(initial,events){return events.reduce((s,e)=>transition(s,e),initial)}\n",
    "src/snapshot.mjs": "import {replay} from './events.mjs';\nexport function checkpoint(initial,events,count){\n if(!Number.isInteger(count)||count<0||count>events.length)throw Error('invalid cursor');\n return {cursor:count,state:replay(initial,events.slice(0,count))};\n}\nexport function resume(check,events){return replay(check.state,events.slice(check.cursor))}\n"
  },
  "W6": {
    "src/entitlements.mjs": "export function hasAccess(state,capability){\n return state.status==='active'&&(capability==='dashboard'||(capability==='reports'&&state.planId==='pro'));\n}\n",
    "src/seats.mjs": "export function reserveSeat(state,seatId) {\n const seats=state.seats||[];\n if(seats.includes(seatId))return state;\n if(seats.length >= (state.planId==='pro'?10:3))throw Error('quota');\n return {...state,seats:[...seats,seatId]};\n}\n",
    "src/change-plan.mjs": "import {listPlans} from './catalog.mjs';\nexport function changePlan(state,planId) {\n if(!listPlans().some(p=>p.id===planId))throw Error('unknown plan');\n return {...state,planId};\n}\n",
    "src/webhook.mjs": "export function applyBillingNotice(state,event){\n const seen=state.seenEvents||[];\n if(seen.includes(event.id)||state.status==='cancelled')return state;\n const status=event.kind==='payment_failed'&&state.status==='active'?'past_due':event.kind==='payment_received'&&state.status==='past_due'?'active':state.status;\n return {...state,status,seenEvents:[...seen,event.id]};\n}\n"
  },
  "W7": {
    "src/render.mjs": "import {escapeHtml} from './html.mjs';\nexport const renderMessage=value=>'<p>'+escapeHtml(value)+'</p>';\n",
    "src/tenant-pages.mjs": "import {page} from './paging.mjs';\nexport const tenantPage=(items,tenant,offset,limit)=>page(items.filter(x=>x.tenant===tenant),offset,limit);\n",
    "src/refunds.mjs": "import {toCents} from './money.mjs';\nexport function refundTotal(lines){return lines.reduce((n,x)=>n+toCents(x.price)*x.qty,0)}\n",
    "src/requests.mjs": "import {parseRequestId} from './ids.mjs';\nexport function requestIdFromHeaders(headers){return parseRequestId(headers?.['x-request-id'])}\n"
  }
}
