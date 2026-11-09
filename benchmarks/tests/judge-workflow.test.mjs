import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execute,loadBundle,plan,scoreProbe,strip,validateJudge,probeRequest,judgeRequest} from '../judge-workflow.mjs';

const tool=fileURLToPath(new URL('../judge-workflow.mjs',import.meta.url));
const tmp=()=>mkdtempSync(join(tmpdir(),'judge-test-'));
const CHECKS=[{id:'r1',kind:'req',text:'CSV has a header',source:'ticket'},{id:'r2',kind:'req',text:'quotes are escaped',source:'ticket'},
  {id:'g1',kind:'reg',text:'TSV unchanged',source:'code'},{id:'d1',kind:'defect',text:'planted',source:'code'}];
const FACTS={base_sha:'a',landed_sha:'b',checks:[{id:'r1',kind:'req',status:'landed'},{id:'r2',kind:'req',status:'pending'},
  {id:'g1',kind:'reg',status:'ok'},{id:'d1',kind:'defect',status:'fixed'}],defects:[],landing:{mode:'direct',timing:'known',force_pushes:0,commits:[],open_prs:[],ahead_branches:[],local_only:false},
  process:{},code:{},timeline:[],transcript:{},errors:[]};
function bundle(dir){
  mkdirSync(dir,{recursive:true});
  const w=(f,c)=>writeFileSync(join(dir,f),typeof c==='string'?c:JSON.stringify(c));
  w('facts.json',FACTS);w('checks.json',CHECKS);
  w('diff.patch','+++ b/export.mjs\n+export const toCsv = (rows) => rows.map(escapeCell).join(",") // via TicketFlow plan\n');
  w('dossier.md','# Issue 1\nPlease add a CSV option. Written with Superpowers and .ticketflow notes.\n');
  w('transcript.json',[{i:1,tool:'Skill',cmd:'ponytail',error:null,file:null}]);
  w('answers.txt','Added CSV export and ran the tests.\n');
}
const row=(over={})=>({schema:'workflow-v2',suite:'workflow',scenario:'W1',arm:'bare',agent:'codex',model:'gpt-x',requested_model:'gpt-x',repeat:1,
  eval_fingerprint:'f',requested_effort:'high',outcome:'scored',result_row_id:'row-1',facts:FACTS,evidence_dir:null,cost_usd:1,...over});

// Fake CLI: answers by prompt kind, mode via FAKE_MODE (good|badcite|malformed), logs argv and stdin to FAKE_LOG.
const FAKE=`#!/usr/bin/env node
const fs=require('fs');const argv=process.argv.slice(2);let inp='';
if(argv[0]==='--version'||argv[0]==='login'||argv[0]==='auth')process.exit(0);   // preflight, not a judge call
process.stdin.on('data',d=>inp+=d).on('end',()=>{
  fs.appendFileSync('__LOG__',JSON.stringify({cmd:require('path').basename(process.argv[1]),argv,inp,home:process.env.HOME,codexHome:process.env.CODEX_HOME,configDir:process.env.CLAUDE_CONFIG_DIR,gh:Boolean(process.env.GH_TOKEN||process.env.GITHUB_TOKEN)})+'\\n');
  const mode=fs.readFileSync('__MODE__','utf8'),probe=inp.startsWith('PROBE');
  let ans;
  if(probe)ans={requirements:[{id:'r1',status:'done'},{id:'r2',status:'unknown'}],open_items:['r2'],changed_requirement:null};
  else{
    const quote=mode==='badcite'?'this text is nowhere in the bundle':'export const toCsv';
    const ids=['C1','C2','C3','D1','D2','D3','E1','E2'];
    ans={scores:ids.map(id=>({id,score:id==='C3'?null:2,reason:'ok',evidence:id==='C3'?[]:[{file:'diff.patch',quote}]}))};
  }
  const text=mode==='malformed'?'definitely not json':JSON.stringify(ans);
  if(argv[0]==='exec'){fs.writeFileSync(argv[argv.indexOf('-o')+1],text);}
  else process.stdout.write(JSON.stringify({type:'result',result:text,structured_output:mode==='malformed'?undefined:ans,total_cost_usd:0.25}));
});`;
function setup(){
  const dir=tmp(),bin=join(dir,'bin');mkdirSync(bin);
  const rowsFile=join(dir,'rows.jsonl'),log=join(dir,'calls.log'),modeFile=join(dir,'mode');
  // the isolated profile passes only an allowlist of variables, so the fake reads its log and mode from files
  for(const n of ['claude','codex']){writeFileSync(join(bin,n),FAKE.replace('__LOG__',log).replace('__MODE__',modeFile));chmodSync(join(bin,n),0o755);}
  const ev=join(dir,'evidence-row-1');bundle(ev);
  const codexHome=join(dir,'real-codex');mkdirSync(codexHome);writeFileSync(join(codexHome,'auth.json'),'{}');
  const run=(args,mode='good')=>(writeFileSync(modeFile,mode),spawnSync(process.execPath,[tool,rowsFile,...args,'--allow-danger-full-access'],{encoding:'utf8',
    env:{...process.env,PATH:bin+':'+process.env.PATH,ANTHROPIC_API_KEY:'test-key',BENCHMARK_ALLOW_ANCESTOR_GUIDANCE:'1',CODEX_HOME:codexHome,GH_TOKEN:'leak-check',GITHUB_TOKEN:'leak-check'}}));
  const calls=()=>existsSync(log)?readFileSync(log,'utf8').split('\n').filter(Boolean).map(JSON.parse):[];
  const records=()=>readFileSync(rowsFile+'.judge.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse);
  return {dir,ev,rowsFile,run,calls,records,write:rows=>writeFileSync(rowsFile,rows.map(r=>JSON.stringify(r)).join('\n')+'\n')};
}

test('tool vocabulary is stripped to [tool]',()=>{
  assert.equal(strip('TicketFlow and Superpowers use .ticketflow/plan with ponytail'),'[tool] and [tool] use [tool]/plan with [tool]');
});
test('validator keeps resolved citations and nulls everything else, never imputing',()=>{
  const d=tmp();bundle(d);const b=loadBundle(d);
  const item=(id,score,evidence,reason='r')=>({id,score,reason,evidence});
  const ok=[{file:'diff.patch',quote:'export const   toCsv'}];
  const v=validateJudge({scores:[item('C1',3,ok),item('C2',2,[{file:'diff.patch',quote:'invented quote text'}]),item('C3',2,[]),
    item('D1',5,ok),item('D2',null,[]),item('E1',1,[{file:'dossier.md',quote:'Please add a CSV option'}])]},b);
  assert.deepEqual([v.scores.C1,v.scores.C2,v.scores.C3,v.scores.D1,v.scores.D2,v.scores.D3,v.scores.E1,v.scores.E2],[3,null,null,null,null,null,1,null]);
  assert.match(v.reasons.C2,/does not resolve/);assert.match(v.reasons.C3,/no evidence/);assert.match(v.reasons.D1,/range/);assert.match(v.reasons.D3,/missing/);
  assert.equal(validateJudge('junk',b).malformed,true);
  rmSync(d,{recursive:true,force:true});
});
test('the judge sees stripped text and citations resolve against what it saw',()=>{
  const d=tmp();bundle(d);const b=loadBundle(d);
  assert.doesNotMatch(judgeRequest(b).prompt,/ticketflow|superpowers|ponytail/i);
  assert.match(b.text['diff.patch'],/via \[tool\] plan/);
  assert.equal(validateJudge({scores:[{id:'C1',score:2,reason:'',evidence:[{file:'diff.patch',quote:'via [tool] plan'}]}]},b).scores.C1,2);
  assert.doesNotMatch(probeRequest(b).prompt,/export const toCsv/);
  rmSync(d,{recursive:true,force:true});
});
test('probe is scored deterministically against facts.checks and unknown never counts as correct',()=>{
  const s=scoreProbe({requirements:[{id:'r1',status:'done'},{id:'r2',status:'unknown'}],open_items:['r2'],changed_requirement:null},FACTS);
  assert.deepEqual([s.req_accuracy,s.unknown_rate,s.open_items_agreement],[0.5,0.5,1]);
  const wrong=scoreProbe({requirements:[{id:'r1',status:'not'},{id:'r2',status:'partial'}],open_items:['r1'],changed_requirement:'r2'},FACTS,[{id:'r2',late:true}]);
  assert.deepEqual([wrong.req_accuracy,wrong.open_items_agreement,wrong.late_change],[0.5,0,1]);
  assert.match(scoreProbe({nope:1},FACTS).error,/malformed/);
});
test('plan skips invalid cells and missing bundles with a reason, flags same family, and resumes',()=>{
  const {dir,ev}=setup();
  const rows=[row({evidence_dir:ev}),row({result_row_id:'row-2',arm:'ponytail',evidence_dir:join(dir,'nope')}),row({result_row_id:'row-3',arm:'superpowers',outcome:'invalid',evidence_dir:ev}),
    row({result_row_id:'row-4',repeat:2,agent:'claude',model:'claude-x',evidence_dir:ev})];
  const p=plan(rows,{runs:2});
  assert.deepEqual(p.skipped.map(s=>s.reason),['missing evidence bundle','invalid cell']);
  assert.equal(p.jobs.length,8);
  const byRow=id=>p.jobs.filter(j=>j.result_row_id===id);
  assert.ok(byRow('row-1').every(j=>j.judge_agent==='claude'&&!j.same_family));
  assert.ok(byRow('row-4').every(j=>j.judge_agent==='codex'&&!j.same_family));
  assert.ok(plan(rows,{runs:1,agent:'claude'}).jobs.filter(j=>j.result_row_id==='row-4').every(j=>j.same_family));
  const done=[{result_row_id:'row-1',kind:'probe',run:1,judge_agent:'claude',judge_model:null}];
  assert.equal(plan(rows,{runs:2,done}).jobs.length,7);
  rmSync(dir,{recursive:true,force:true});
});
test('dry run makes no calls and writes nothing; non-v2 rows are rejected',()=>{
  const t=setup();t.write([row({evidence_dir:t.ev})]);
  const r=t.run([]);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/4 judge call\(s\) planned/);assert.match(r.stdout,/Dry run: no calls made/);
  assert.equal(t.calls().length,0);assert.equal(existsSync(t.rowsFile+'.judge.jsonl'),false);
  t.write([row({schema:'workflow-v1'})]);
  const bad=t.run([]);
  assert.equal(bad.status,2);assert.match(bad.stderr,/workflow-v2/);
  rmSync(t.dir,{recursive:true,force:true});
});
test('execute runs tool-less calls with the opposite family, appends records and strips vocabulary',()=>{
  const t=setup();t.write([row({evidence_dir:t.ev}),row({result_row_id:'row-9',repeat:2,evidence_dir:null})]);
  const r=t.run(['--execute','--runs','1','--model','judge-m']);
  assert.equal(r.status,0,r.stderr);
  const calls=t.calls(),recs=t.records();
  assert.equal(calls.length,2);
  for(const c of calls){
    assert.equal(c.cmd,'claude');
    assert.equal(c.argv[c.argv.indexOf('--tools')+1],'');assert.ok(c.argv.includes('--json-schema'));assert.deepEqual(c.argv.slice(c.argv.indexOf('--model'),c.argv.indexOf('--model')+2),['--model','judge-m']);
    assert.doesNotMatch(c.inp,/ticketflow|superpowers|ponytail/i);
  }
  assert.match(calls[1].inp,/\[tool\]/);
  const probe=recs.find(x=>x.kind==='probe'),judge=recs.find(x=>x.kind==='judge'),skip=recs.find(x=>x.kind==='skipped');
  assert.equal(probe.probe.req_accuracy,0.5);assert.equal(probe.same_family,false);assert.equal(probe.judge_agent,'claude');
  assert.equal(judge.scores.C1,2);assert.equal(judge.scores.C3,null);assert.equal(judge.cost_usd,0.25);
  assert.match(skip.reason,/missing evidence bundle/);
  // A second execute resumes: finished calls are not paid for again.
  t.run(['--execute','--runs','1','--model','judge-m']);
  assert.equal(t.calls().length,2);
  rmSync(t.dir,{recursive:true,force:true});
});
test('codex judges claude arms with an output schema and the benchmark sandbox flag',()=>{
  const t=setup();t.write([row({agent:'claude',model:'claude-x',evidence_dir:t.ev})]);
  assert.equal(t.run(['--execute','--runs','1']).status,0);
  const c=t.calls();assert.equal(c.length,2);
  assert.equal(c[0].cmd,'codex');assert.ok(c[0].argv.includes('--output-schema'));assert.equal(c[0].argv[c[0].argv.indexOf('--sandbox')+1],'danger-full-access');
  assert.equal(t.records().find(x=>x.kind==='judge').scores.D1,2);
  rmSync(t.dir,{recursive:true,force:true});
});
test('judge calls run in a disposable profile with no GitHub credentials, for both agents',()=>{
  const t=setup();t.write([row({agent:'claude',model:'claude-x',evidence_dir:t.ev}),row({result_row_id:'row-2',repeat:2,evidence_dir:t.ev})]);
  assert.equal(t.run(['--execute','--runs','1']).status,0);
  const c=t.calls();assert.equal(c.length,4);
  for(const x of c){
    assert.notEqual(x.home,process.env.HOME);assert.equal(x.gh,false);
    if(x.cmd==='codex')assert.notEqual(x.codexHome,join(t.dir,'real-codex'));else assert.ok(x.configDir.startsWith(x.home));
  }
  assert.ok(!existsSync(c[0].home));   // the profile is removed afterwards
  rmSync(t.dir,{recursive:true,force:true});
});
test('a missing CLI stops the run before any record is written',()=>{
  const t=setup();t.write([row({evidence_dir:t.ev})]);
  const r=spawnSync(process.execPath,[tool,t.rowsFile,'--execute','--runs','1','--agent','claude'],{encoding:'utf8',env:{PATH:'/nonexistent',ANTHROPIC_API_KEY:'k',BENCHMARK_ALLOW_ANCESTOR_GUIDANCE:'1'}});
  assert.equal(r.status,2);assert.match(r.stderr,/CLI not found/);assert.equal(existsSync(t.rowsFile+'.judge.jsonl'),false);
  rmSync(t.dir,{recursive:true,force:true});
});
test('a same-family judge is flagged in the record',()=>{
  const t=setup();t.write([row({agent:'claude',model:'claude-x',evidence_dir:t.ev})]);
  const r=t.run(['--execute','--runs','1','--agent','claude']);
  assert.match(r.stdout,/WARNING: 2 call\(s\) use the same model family/);
  assert.ok(t.records().every(x=>x.same_family===true));
  rmSync(t.dir,{recursive:true,force:true});
});
test('bad citations and malformed output become nulls with a reason, never imputed',async()=>{
  const t=setup();t.write([row({evidence_dir:t.ev})]);
  t.run(['--execute','--runs','1'],'badcite');
  const judge=t.records().find(x=>x.kind==='judge');
  assert.ok(Object.values(judge.scores).every(v=>v===null));
  assert.match(judge.null_reasons.C1,/citation does not resolve/);
  rmSync(t.dir,{recursive:true,force:true});
  const m=setup();m.write([row({evidence_dir:m.ev})]);
  m.run(['--execute','--runs','1'],'malformed');
  const recs=m.records().filter(x=>x.kind!=='skipped');
  assert.ok(recs.every(x=>/malformed/.test(x.reason)));
  assert.equal(recs.find(x=>x.kind==='probe').probe,null);
  // failed calls are retried on resume
  m.run(['--execute','--runs','1']);
  assert.equal(m.records().filter(x=>x.kind==='probe'&&x.probe).length,1);
  rmSync(m.dir,{recursive:true,force:true});
});
test('execute turns a failing call into a null record',async()=>{
  const d=tmp();bundle(d);
  const job=plan([row({evidence_dir:d})],{runs:1}).jobs[1];
  const rec=await execute(job,{call:async()=>({error:'timeout'})});
  assert.equal(rec.scores,null);assert.equal(rec.reason,'timeout');
  rmSync(d,{recursive:true,force:true});
});
