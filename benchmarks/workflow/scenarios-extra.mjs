/** Independent workflow scenarios. Keep hidden assertions out of the seeded GitHub repos. */
const lines = a => a.join('\n')+'\n';
export const extraScenarios = {
  W6: {
    title:'Brainstorm a feature, create tasks, then coordinate delivery',
    issues:[],
    goal:'Start from the broad product request in README.md. Brainstorm a practical design, organize useful tracked tasks and their dependencies, then implement, verify, review and deliver the full feature. Avoid unnecessary ticket proliferation.',
    files:{
      'README.md':lines([
        '# Subscription service request',
        'We need a small monthly-subscription capability for team accounts.',
        'Please determine the appropriate breakdown of implementation work and ship it.',
        'Contract: plans are basic (990 cents per month) and pro (1990 cents per month).',
        'src/catalog.mjs exports listPlans(), returning [{id,priceCents}] in basic, pro order.',
        'src/subscription.mjs exports openSubscription(planId,day), cancelSubscription(state), and renewSubscription(state,day).',
        'Opening a valid plan creates {planId,status:"active",renewalDay:day+30}. Invalid plans throw.',
        'Cancellation returns an immutable state with status "cancelled" and is idempotent.',
        'Renewal on active subscriptions moves renewalDay forward 30 days. Cancelled ones do not renew.',
        'src/billing.mjs exports invoicePreview(state): {amountCents,planId} for active plans, zero amount for cancelled.',
        'No new dependencies. Consider tests for state transitions, pricing and cancellation.'
      ]),
      'src/catalog.mjs':lines(['export function listPlans(){ return []; }']),
      'src/subscription.mjs':lines([
        'export function openSubscription(planId,day){throw Error("Not implemented");}',
        'export function cancelSubscription(state){throw Error("Not implemented");}',
        'export function renewSubscription(state,day){throw Error("Not implemented");}'
      ]),
      'src/billing.mjs':lines(['export function invoicePreview(state){throw Error("Not implemented");}']),
      'test/subscriptions.test.mjs':lines([
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import {listPlans} from '../src/catalog.mjs';",
        "test('catalog returns a list',()=>assert.ok(Array.isArray(listPlans())));"
      ])
    },
    hidden:{
      module:'src/subscription.mjs',
      code:lines([
        "const catalog=await import(pathToFileURL(join(dir,'src/catalog.mjs')).href);",
        "const billing=await import(pathToFileURL(join(dir,'src/billing.mjs')).href);",
        "assert.deepEqual(catalog.listPlans(),[{id:'basic',priceCents:990},{id:'pro',priceCents:1990}]);",
        "assert.throws(()=>mod.openSubscription('unknown',0));",
        "const a=mod.openSubscription('basic',5);",
        "assert.deepEqual(a,{planId:'basic',status:'active',renewalDay:35});",
        "assert.deepEqual(billing.invoicePreview(a),{amountCents:990,planId:'basic'});",
        "const renewed=mod.renewSubscription(a,35);",
        "assert.deepEqual(renewed,{planId:'basic',status:'active',renewalDay:65});",
        "assert.deepEqual(a,{planId:'basic',status:'active',renewalDay:35});",
        "const b=mod.cancelSubscription(a);",
        "assert.deepEqual(b,{planId:'basic',status:'cancelled',renewalDay:35});",
        "assert.deepEqual(mod.cancelSubscription(b),b);",
        "assert.deepEqual(mod.renewSubscription(b,35),b);",
        "assert.deepEqual(billing.invoicePreview(b),{amountCents:0,planId:'basic'});",
        "assert.deepEqual(billing.invoicePreview(mod.openSubscription('pro',0)),{amountCents:1990,planId:'pro'});"
      ])
    }
  },
  W7: {
    title:'Coordinate four independent tickets and integrate safely',
    issues:[
      'Implement escapeHtml(value) in src/html.mjs for &, <, >, double quotes and apostrophes. Escape each character once.',
      'Implement page(items,offset,limit) in src/paging.mjs returning {items,next}. Use null next for the final page, reject noninteger, negative offset and nonpositive limit.',
      'Implement toCents(value) in src/money.mjs using half-up rounding to integer cents, including 1.005 and 2.015.',
      'Implement parseRequestId(value) in src/ids.mjs, accepting exactly eight lowercase hexadecimal characters and otherwise returning null.'
    ],
    goal:'Deliver four independent tickets. Choose appropriate sequential or parallel execution, avoid conflicts and duplicate work, verify and review changes, and merge completed work safely. The goal is reliable integrated delivery, not parallelism for its own sake.',
    files:{
      'src/html.mjs':lines(["export const escapeHtml=value=>String(value);"]),
      'src/paging.mjs':lines(["export function page(items,offset,limit){return {items:items.slice(offset,offset+limit),next:offset+limit};}"]),
      'src/money.mjs':lines(["export const toCents=value=>Math.floor(value*100);"]),
      'src/ids.mjs':lines(["export const parseRequestId=value=>String(value);"]),
      'test/utilities.test.mjs':lines([
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import {page} from '../src/paging.mjs';",
        "test('basic paging',()=>assert.deepEqual(page([1,2,3],0,1).items,[1]));"
      ])
    },
    hidden:{
      module:'src/html.mjs',
      code:lines([
        "const paging=await import(pathToFileURL(join(dir,'src/paging.mjs')).href);",
        "const money=await import(pathToFileURL(join(dir,'src/money.mjs')).href);",
        "const ids=await import(pathToFileURL(join(dir,'src/ids.mjs')).href);",
        'assert.equal(mod.escapeHtml(\'&<>"\\\'\'),\'&amp;&lt;&gt;&quot;&#39;\');',
        "assert.equal(mod.escapeHtml('A & B'),'A &amp; B');",
        "assert.deepEqual(paging.page([1,2,3],0,2),{items:[1,2],next:2});",
        "assert.deepEqual(paging.page([1,2,3],2,2),{items:[3],next:null});",
        "assert.throws(()=>paging.page([1],0,0));",
        "assert.throws(()=>paging.page([1],-1,1));",
        "assert.equal(money.toCents(1.005),101);",
        "assert.equal(money.toCents(2.015),202);",
        "assert.equal(ids.parseRequestId('abcdef01'),'abcdef01');",
        "assert.equal(ids.parseRequestId('ABCDEF01'),null);",
        "assert.equal(ids.parseRequestId('abcdef012'),null);",
        "assert.equal(ids.parseRequestId(null),null);"
      ])
    }
  }
};
