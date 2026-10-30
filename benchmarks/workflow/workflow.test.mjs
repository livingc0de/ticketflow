import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scenarios,ids,fixture,prompt } from './scenarios.mjs';
import { evaluateEvidence } from './check.mjs';
import { cfg } from './sandbox.mjs';
import { validate } from '../../core/lib/config.mjs';

test('seven distinct delivery scenarios with intended initial states',()=>{
  assert.deepEqual(ids,['W1','W2','W3','W4','W5','W6','W7']);
  assert.deepEqual(ids.map(id=>scenarios[id].issues.length),[0,1,3,1,1,0,4]);
  for(const id of ids){
    const f=fixture(id);
    assert.ok(f['package.json']&&f['.github/workflows/bench.yml']);
    assert.ok(Object.keys(f).some(p=>p.startsWith('test/')));
    const p=prompt(id,'bench/repo',[12],null,'https://github.com/orgs/bench/projects/1');
    assert.match(p,/Use your own available development approach/);
    assert.doesNotMatch(p,/use TicketFlow's/);
    assert.ok(scenarios[id].hidden.module);
    assert.doesNotThrow(()=>new Function('return (async()=>{'+scenarios[id].hidden.code+'})'));
  }
  assert.match(scenarios.W6.goal,/brainstorm/i);
  assert.match(scenarios.W7.goal,/parallel/i);
  assert.equal(scenarios.W4.seedBrokenPR.branch,'bench/broken-webhook');
});
test('fixtures are self-contained and initial repository tests succeed',()=>{
  for(const id of ids){
    const dir=mkdtempSync(join(tmpdir(),'workflow-scenario-unit-'));
    try {
      for(const [path,body] of Object.entries(fixture(id))){
        const dest=join(dir,path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,body);
      }
      const result=spawnSync('npm',['test'],{cwd:dir,encoding:'utf8',timeout:30000});
      assert.equal(result.status,0,id+': '+result.stderr+'\n'+result.stdout);
    } finally{rmSync(dir,{recursive:true,force:true});}
  }
});
test('TicketFlow config supplied to fixture is valid without requiring competitors to use it',()=>{
  assert.doesNotThrow(()=>validate(cfg('bench/repo','bench',3,'claude')));
  assert.doesNotThrow(()=>validate(cfg('bench/repo','bench',3,'codex')));
});
const issue=(n,{seeded=false,closed=true,comments=1,title=null,body=null}={})=>({
  number:n,seeded,state:closed?'closed':'open',comments,events:[],
  title:title??`Implement independent workflow task ${n}`,
  body:body??`Implement the independently actionable workflow task ${n}.${n>2?` Depends on #${n-1}.`:''}`,
});
const pr=(n,body,sha='aaaa')=>({number:n,body,headRefOid:sha,mergedAt:'2026-10-31T00:00:00Z'});
const evidence=(id,{seeded=[],issues=[],prs=[],good=true,review=true,ci=true,interrupted=true,
  initialPR=null,initialHead=null}={})=>
  evaluateEvidence({id,seededIssues:seeded,issues,prs,
    checks:prs.map(p=>({number:p.number,pass:ci})),
    reviews:prs.map(p=>({number:p.number,observed:review,unresolved:false})),
    plans:[],hidden:good,repoTests:true,interrupted,initialPR,initialHead});
test('W1 scores newly created and linked ticket, not a supplied empty project',()=>{
  const p=pr(20,'Closes #7');const pass=evidence('W1',{issues:[issue(7)],prs:[p]});
  assert.equal(pass.pipeline,true);
  const noIssue=evidence('W1',{prs:[pr(20,'Delivered change')]});
  assert.equal(noIssue.functionality,true);
  assert.equal(noIssue.steps.issue_tracking,false);
  assert.equal(noIssue.pipeline,false);
});
test('W2 preserves existing issue coverage independent of workflow-specific statuses',()=>{
  const pass=evidence('W2',{seeded:[2],issues:[issue(2,{closed:true})],prs:[pr(19,'Closes #2')]});
  assert.equal(pass.pipeline,true);
  const missing=evidence('W2',{seeded:[2],issues:[issue(2,{closed:false})],prs:[pr(19,'Refs #2')]});
  assert.equal(missing.steps.issue_tracking,false);
});
test('W3 requires all dependent tickets to be linked and closed',()=>{
  const source=[issue(1),issue(2),issue(3)];
  assert.equal(evidence('W3',{seeded:[1,2,3],issues:source,prs:[pr(9,'Closes #1, #2 and #3')]}).pipeline,true);
  assert.equal(evidence('W3',{seeded:[1,2,3],issues:source,prs:[pr(9,'Closes #1 and #2')]}).pipeline,false);
});
test('W4 seeded PR is actually corrected and verified',()=>{
  const source=[issue(1)];
  const fine=evidence('W4',{seeded:[1],issues:source,prs:[pr(4,'Closes #1','new')],initialPR:4,initialHead:'old'});
  assert.equal(fine.pipeline,true);
  const stale=evidence('W4',{seeded:[1],issues:source,prs:[pr(4,'Closes #1','old')],initialPR:4,initialHead:'old'});
  assert.equal(stale.steps.failed_pr_corrected,false);
  assert.equal(stale.pipeline,false);
});
test('W5 requires an actual recorded interruption and recovery',()=>{
  const source={seeded:[1],issues:[issue(1)],prs:[pr(2,'Closes #1')]};
  assert.equal(evidence('W5',{...source,interrupted:true}).pipeline,true);
  assert.equal(evidence('W5',{...source,interrupted:false}).pipeline,false);
});
test('W6 requires multiple useful tickets linked to delivered work, not count alone',()=>{
  const tasks=[issue(2),issue(3)];
  const pass=evidence('W6',{issues:tasks,prs:[pr(8,'Closes #2 and #3')]});
  assert.equal(pass.pipeline,true);
  assert.equal(pass.process.agent_created_issues,2);
  assert.equal(evidence('W6',{issues:tasks,prs:[pr(8,'Closes #2')]}).pipeline,false);
  assert.equal(evidence('W6',{issues:[issue(2)],prs:[pr(8,'Closes #2')]}).pipeline,false);
  assert.equal(evidence('W6',{issues:[issue(2,{title:'Task #2',body:''}),issue(3)],prs:[pr(8,'Closes #2 and #3')]}).pipeline,false);
  assert.equal(evidence('W6',{issues:[issue(2),issue(3,{title:issue(2).title,body:issue(2).body})],prs:[pr(8,'Closes #2 and #3')]}).pipeline,false);
  assert.equal(evidence('W6',{issues:[issue(2,{body:'Implement the task without a dependency.'}),issue(3,{body:'Implement another task without a dependency.'})],prs:[pr(8,'Closes #2 and #3')]}).pipeline,false);
  assert.equal(evidence('W6',{issues:[issue(2),issue(3,{body:'Implement task 3. Depends on #99.'})],prs:[pr(8,'Closes #2 and #3')]}).pipeline,false);
});
test('W7 checks four tickets and allows multiple safely merged PRs',()=>{
  const seed=[1,2,3,4],issues=seed.map(n=>issue(n));
  const prs=seed.map(n=>pr(n+10,'Closes #'+n));
  const pass=evidence('W7',{seeded:seed,issues,prs});
  assert.equal(pass.pipeline,true);
  assert.equal(pass.process.merged_pr_count,4);
  const missing=evidence('W7',{seeded:seed,issues,prs:prs.slice(0,3)});
  assert.equal(missing.pipeline,false);
});
test('pipeline gates remain independent of hidden code correctness',()=>{
  const c={seeded:[1],issues:[issue(1)],prs:[pr(6,'Closes #1')]};
  assert.equal(evidence('W2',{...c,good:false}).functionality,false);
  assert.equal(evidence('W2',{...c,ci:false}).steps.latest_head_ci,false);
  assert.equal(evidence('W2',{...c,review:false}).steps.review_evidence,false);
  assert.equal(evidence('W2',{...c,review:false}).functionality,true);
});
