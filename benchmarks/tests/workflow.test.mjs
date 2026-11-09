import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture,scenarios,ids,runCheck} from '../workflow/scenarios.mjs';
import {reference,referenceMinusDefects} from '../workflow/reference.mjs';

/** Writes a file set to a temp dir, runs fn(dir), cleans up. */
function inRepo(files,fn) {
  const dir=mkdtempSync(join(tmpdir(),'workflow-matrix-'));
  try {
    for(const [path,content] of Object.entries(files)) {
      const target=join(dir,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);
    }
    return fn(dir);
  } finally {rmSync(dir,{recursive:true,force:true});}
}
const ownTests=(dir,files)=>spawnSync(process.execPath,['--test',...Object.keys(files).filter(p=>/^test\/.*\.test\.mjs$/.test(p))],
  {cwd:dir,encoding:'utf8',timeout:60000,env:{PATH:process.env.PATH}}).status===0; // no NODE_TEST_CONTEXT: a nested runner would always exit 0
/** {checkId: pass} plus the repository's own test result */
function evaluate(id,files) {
  return inRepo(files,dir=>({
    own:ownTests(dir,files),
    checks:Object.fromEntries(scenarios[id].checks.map(c=>[c.id,runCheck(dir,c).pass])),
  }));
}
const of=(id,kind)=>scenarios[id].checks.filter(c=>c.kind===kind);

test('starting repository: own tests pass, requirements fail, regressions pass, defects fail',()=>{
  for(const id of ids) {
    const r=evaluate(id,fixture(id));
    assert.ok(r.own,id+' own tests must pass on the starting repository');
    for(const c of of(id,'req')) assert.equal(r.checks[c.id],false,id+'/'+c.id+' requirement must fail at the start');
    for(const c of of(id,'reg')) assert.equal(r.checks[c.id],true,id+'/'+c.id+' regression check must pass at the start');
    for(const c of of(id,'defect')) {
      // W4's defect and one regression exist only in the seeded pull request, see the next test
      if(id==='W4') assert.equal(r.checks[c.id],true);
      else assert.equal(r.checks[c.id],false,id+'/'+c.id+' defect must be present at the start');
    }
  }
});
test('W4 pull request head is red, regresses dedupe, and carries the planted defect',()=>{
  const r=evaluate('W4',fixture('W4',{withPR:true}));
  assert.equal(r.own,false,'the seeded PR must be red');
  assert.equal(r.checks['apply-dedupe'],false);
  assert.equal(r.checks['apply-immutable'],true);
  assert.equal(r.checks['reverse-once'],false);
  assert.equal(r.checks['batch-applies'],true);
  assert.equal(r.checks['batch-dedupe'],false);
  assert.equal(r.checks['batch-immutable'],false);
});
test('reference solution passes every check and the repository tests',()=>{
  for(const id of ids) {
    const files=reference(id);
    const r=evaluate(id,files);
    assert.ok(r.own,id+' own tests on the reference');
    for(const c of scenarios[id].checks) {
      if(c.supersededBy) {
        assert.equal(r.checks[c.supersededBy],true,id+' superseding check '+c.supersededBy);
        continue;
      }
      assert.equal(r.checks[c.id],true,id+'/'+c.id+' on the reference: '+inRepo(files,d=>runCheck(d,c).reason));
    }
  }
});
test('reference without the defect fixes: requirements and own tests pass, defects remain',()=>{
  for(const id of ids) {
    const r=evaluate(id,referenceMinusDefects(id));
    assert.ok(r.own,id+' own tests');
    for(const c of scenarios[id].checks) {
      if(c.supersededBy) continue;
      assert.equal(r.checks[c.id],c.kind!=='defect',id+'/'+c.id+' ('+c.kind+') on the reference minus defect fixes');
    }
  }
});
test('every scenario but the control plants at least one defect; the control plants none',()=>{
  assert.equal(of('W1','defect').length,0);
  for(const id of ids.filter(x=>x!=='W1')) assert.ok(of(id,'defect').length>=1,id);
  assert.equal(of('W7','defect').length,2);
});
test('a requirement superseded by a later change is satisfied by the earlier-stage solution but not the final one',()=>{
  const files={...reference('W7'),'src/ids.mjs':"export const parseRequestId = (v) => (typeof v === 'string' && /^[0-9a-f]{8}$/.test(v) ? v : null);\n"};
  const checks=Object.fromEntries(scenarios.W7.checks.map(c=>[c.id,c]));
  inRepo(files,dir=>{
    assert.equal(runCheck(dir,checks['ids-lowercase-only']).pass,true);
    assert.equal(runCheck(dir,checks['ids-normalise']).pass,false);
  });
  inRepo(reference('W7'),dir=>assert.equal(runCheck(dir,checks['ids-lowercase-only']).pass,false));
});
test('runCheck: failing assertion, missing module and runaway code are failures; env is stripped; checkout is not written to',()=>{
  inRepo({'a.mjs':'export const x=1;\n','loop.mjs':'while(true){}\n','env.mjs':'export const e=process.env.SECRET_BENCH_TOKEN??null;\n'},dir=>{
    process.env.SECRET_BENCH_TOKEN='leak';
    try {
      assert.equal(runCheck(dir,{id:'t',code:"const m=await load('a.mjs'); assert.equal(m.x,1);"}).pass,true);
      const bad=runCheck(dir,{id:'t',code:"const m=await load('a.mjs'); assert.equal(m.x,2);"});
      assert.equal(bad.pass,false); assert.match(bad.reason,/AssertionError/);
      assert.equal(runCheck(dir,{id:'t',code:"await load('nope.mjs');"}).pass,false);
      const slow=runCheck(dir,{id:'t',code:"await load('loop.mjs');"},{timeoutMs:500});
      assert.deepEqual([slow.pass,/timed out/.test(slow.reason)],[false,true]);
      assert.equal(runCheck(dir,{id:'t',code:"const m=await load('env.mjs'); assert.equal(m.e,null);"}).pass,true);
    } finally {delete process.env.SECRET_BENCH_TOKEN;}
    assert.deepEqual(spawnSync('ls',['-A'],{cwd:dir,encoding:'utf8'}).stdout.trim().split('\n').sort(),['a.mjs','env.mjs','loop.mjs']);
  });
});
