import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture,scenarios,ids,prompt} from '../workflow/scenarios.mjs';

const repairs={
  W1:{'src/report.mjs': [
    "export const columns=['name','total'];",
    "export const tsv=rows=>[columns.join('\\t'),...rows.map(r=>columns.map(k=>r[k]).join('\\t'))].join('\\n');",
    "export const csv=rows=>[columns.join(','),...rows.map(r=>columns.map(k=>{const v=String(r[k]);return /[\\\",\\n\\r]/.test(v)?'\\\"'+v.replaceAll('\\\"','\\\"\\\"')+'\\\"':v}).join(','))].join('\\n');"
  ].join('\n')+'\n'},
  W2:{
    'src/money.mjs':"export const toCents = amount => Math.round((amount+Number.EPSILON)*100)/100;\n"
  },
  W3:{
    'src/store.mjs':"export const lookupOrder=(orders,tenant,id)=>orders.find(o=>o.tenant===tenant&&o.id===id)??null;\n",
    'src/paging.mjs':"export const page=(rows,start,size)=>({items:rows.slice(start,start+size),next:start+size<rows.length?start+size:null});\n",
    'src/api.mjs':"import {lookupOrder} from './store.mjs';\nimport {page} from './paging.mjs';\nexport const getOrder=(rows,tenant,id)=>lookupOrder(rows,tenant,id);\nexport const listOrders=(rows,tenant,start,size)=>page(rows.filter(x=>x.tenant===tenant),start,size);\n"
  },
  W4:{'src/webhook.mjs':"export const applyEvent=(s,e)=>s.seen.includes(e.id)?s:{balance:s.balance+e.delta,seen:[...s.seen,e.id]};\n"},
  W5:{'src/orders.mjs':"const allowed={created:'paid',paid:'shipped'};\nexport const transition=(s,e)=>s.history.includes(e.id)||allowed[s.status]!==e.to?s:{status:e.to,history:[...s.history,e.id]};\n"},
  W6:{
    'src/catalog.mjs':"export const listPlans=()=>[{id:'basic',priceCents:990},{id:'pro',priceCents:1990}];\n",
    'src/subscription.mjs': [
      "import {listPlans} from './catalog.mjs';",
      "export const openSubscription=(planId,day)=>{if(!listPlans().some(p=>p.id===planId))throw Error('invalid plan');return {planId,status:'active',renewalDay:day+30};};",
      "export const cancelSubscription=s=>s.status==='cancelled'?s:{...s,status:'cancelled'};",
      "export const renewSubscription=s=>s.status==='active'?{...s,renewalDay:s.renewalDay+30}:s;"
    ].join('\n')+'\n',
    'src/billing.mjs':"import {listPlans} from './catalog.mjs';\nexport const invoicePreview=s=>({planId:s.planId,amountCents:s.status==='active'?listPlans().find(p=>p.id===s.planId).priceCents:0});\n"
  },
  W7:{
    'src/html.mjs':"export const escapeHtml=value=>String(value).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\n",
    'src/paging.mjs':"export const page=(items,offset,limit)=>{if(!Number.isInteger(offset)||!Number.isInteger(limit)||offset<0||limit<=0)throw Error('bad page');return {items:items.slice(offset,offset+limit),next:offset+limit<items.length?offset+limit:null};};\n",
    'src/money.mjs':"export const toCents=v=>Math.round((v+Number.EPSILON)*100);\n",
    'src/ids.mjs':"export const parseRequestId=v=>typeof v==='string'&&/^[0-9a-f]{8}$/.test(v)?v:null;\n"
  }
};
function check(id,correct) {
  const dir=mkdtempSync(join(tmpdir(),'workflow-fixture-test-'));
  try{
    const files={...fixture(id)};
    if(id==='W4' && !correct) Object.assign(files,scenarios[id].seedBrokenPR.changes);
    if(correct) Object.assign(files,repairs[id]);
    for(const [path,content] of Object.entries(files)){
      const target=join(dir,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);
    }
    const spec=scenarios[id].hidden;
    const checkPath=join(dir,'hidden.mjs');
    writeFileSync(checkPath,[
      "import assert from 'node:assert/strict';",
      "import {join} from 'node:path';",
      "import {pathToFileURL} from 'node:url';",
      "const dir=process.cwd();",
      "const mod=await import(pathToFileURL(join(dir,"+JSON.stringify(spec.module)+")).href);",
      spec.code
    ].join('\n'));
    return spawnSync(process.execPath,[checkPath],{cwd:dir,encoding:'utf8',timeout:6000});
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test('seven pipeline scenarios have distinct lifecycle starting states',()=>{
  assert.deepEqual(ids,['W1','W2','W3','W4','W5','W6','W7']);
  assert.equal(scenarios.W6.issues.length,0);
  assert.equal(scenarios.W7.issues.length,4);
  assert.equal(scenarios.W1.issues.length,0);
  assert.equal(scenarios.W2.issues.length,1);
  assert.equal(scenarios.W3.issues.length,3);
  assert.equal(scenarios.W4.issues.length,1);
  assert.ok(scenarios.W4.seedBrokenPR.review);
  assert.equal(scenarios.W5.issues.length,1);
});
test('prompts describe product outcomes without mandating TicketFlow commands',()=>{
  for(const id of ids){
    const message=prompt(id,'disposable/repo',scenarios[id].issues.map((_,i)=>i+10));
    assert.doesNotMatch(message,/run ticketflow|orchestrate-tickets|\.ticketflow\/scripts|status In Review/i);
    assert.match(message,/review/i);
  }
});
test('hidden product checkers reject broken fixtures and pass reference repairs',()=>{
  for(const id of ids){
    const broken=check(id,false);
    assert.notEqual(broken.status,0,id+' unexpectedly passes broken fixture');
    const fixed=check(id,true);
    assert.equal(fixed.status,0,id+' repair failed: '+(fixed.stderr||fixed.stdout));
  }
});
test('fixture files are local-only and have working repo tests',()=>{
  for(const id of ids){
    const files=fixture(id);
    assert.ok(files['package.json']);
    assert.ok(files['.github/workflows/bench.yml']);
    assert.ok(!Object.keys(files).some(p=>/hidden|cases\.json/.test(p)));
  }
});
