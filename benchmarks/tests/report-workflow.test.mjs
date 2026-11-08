import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {render} from '../report-workflow.mjs';

const tool=fileURLToPath(new URL('../report-workflow.mjs',import.meta.url));
const facts=(over={})=>({base_sha:'a',landed_sha:'b',
  checks:[{id:'r1',kind:'req',status:'landed'},{id:'r2',kind:'req',status:'pending'},{id:'g1',kind:'reg',status:'ok'},{id:'d1',kind:'defect',status:'fixed'}],
  defects:[{id:'d1',class:'fixed',in_scope:true}],
  landing:{mode:'direct',timing:'known',force_pushes:0,commits:[{sha:'b',via:'direct',pr:null,time:null,verified:{remote:true,local:'yes'}}],open_prs:[],ahead_branches:[],local_only:false},
  process:{durable_record:{issues:2,issue_comments:1,pr_bodies:0,docs_changed:['NOTES.md'],commit_bodies:3},review_observed:true,review_before_landing:true,unsafe_landing:false,unsafe_reasons:[]},
  code:{deps_added:[],files_outside_scope:[],lines_added:40,lines_removed:5,own_tests_fail_on_base:true},timeline:[],
  transcript:{tool_calls:30,subagents:1,permission_denials:0,local_verification_before_push:true},errors:[],...over});
const row=(arm,over={})=>({schema:'workflow-v2',suite:'workflow',scenario:'W2',arm,agent:'claude',agent_version:'fake',requested_model:'test',requested_effort:'high',
  eval_fingerprint:'fixed',profile_isolation:'isolated',sandbox_mode:'not-applicable',profile_cleanup:'ok',outcome:'scored',invalid_reasons:[],
  result_row_id:'id-'+arm+(over.repeat??1),repeat:1,sessions:[{start:'t',end:'t',exit:0,continuations:1,interrupt:null}],interventions:1,facts:facts(),
  evidence_dir:'/home/secret/evidence-x',agent_exit:0,wall_s:60,cost_usd:0.1,turns:10,transcript_archives:['record'],...over});
const section=(md,title)=>md.split('\n## ').find(s=>s.startsWith(title))??'';

test('report has separate axis tables, per arm and per scenario/arm, each with cost, and no blended score',()=>{
  const md=render([row('bare'),row('ticketflow',{scenario:'W3'})]);
  for(const t of ['A. Delivery','B. Autonomy','C. Code','D. History and reasoning','E. Review and fix','P. Process','F. Cost']){
    const s=section(md,t);
    assert.ok(s,t);assert.match(s,/\nPer arm\n/);assert.match(s,/\nPer scenario \/ arm\n/);assert.match(s,/Median USD|Total USD/);
  }
  assert.match(md,/\| W2 \/ bare \| 1 \|/);assert.match(md,/\| ticketflow \| 1 \|/);
  assert.match(section(md,'A. Delivery'),/\| bare \| 1 \| 50% \| 50% \| 0% \| 0% \| 0 \| 0 \| 1\/0\/0\/0 \| 0\.10 \|/);
  assert.match(section(md,'B. Autonomy'),/\| bare \| 1 \| 1\.0 \| 1 \| 0 \| 0\/0 \| 1\.0 \| 1\.0 \| 0\.0 \| 0\.10 \|/);
  assert.match(section(md,'E. Review and fix'),/\| bare \| 1 \| 1 \| 0 \| 0 \| 0 \| 100% \| 100% \| 0 \| 0\.10 \|/);
  assert.match(md,/no blended score/);
  assert.doesNotMatch(md,/Probe req accuracy|\(judge\)/);assert.match(md,/No judge file given/);
});
test('non-workflow-v2 rows are rejected with a clear message',()=>{
  assert.throws(()=>render([{...row('bare'),schema:'workflow-v1'}]),/'workflow-v2'.*'workflow-v1'/);
  assert.throws(()=>render([{...row('bare'),schema:undefined}]),/found 'none'/);
  assert.throws(()=>render([]),/at least one/);
});
test('invalid cells are excluded, listed with reasons and their spend disclosed',()=>{
  const bad=row('bare',{repeat:2,outcome:'invalid',invalid_reasons:['transcript_archive_failed'],cost_usd:0.31});
  const md=render([row('bare'),bad]);
  assert.match(md,/Scored cells: \*\*1\*\* \| Invalid cells excluded: \*\*1\*\*/);
  assert.match(md,/\| W2 \| bare \| 2 \| transcript_archive_failed \|/);
  assert.match(md,/Invalid-attempt spend[^\n]*\$0\.31/);assert.match(md,/Invalid-run warning/);
  assert.match(section(md,'A. Delivery'),/\| bare \| 1 \|/);
});
test('a fresh valid retry supersedes the invalid attempt without erasing its spend',()=>{
  const first=row('ticketflow',{outcome:'invalid',attempt:1,invalid_reasons:['plugin_cleanup_failed'],cost_usd:0.29});
  const second=row('ticketflow',{attempt:2,retry_of:'x',cost_usd:0.15});
  const md=render([first,second]);
  assert.match(md,/Scored cells: \*\*1\*\* \| Invalid cells excluded: \*\*0\*\* \| Recorded attempts including retries: \*\*2\*\*/);
  assert.match(md,/Invalid-attempt spend[^\n]*\$0\.29/);
  assert.doesNotMatch(md,/Invalid-run warning/);
});
test('unknown facts stay unknown and are never imputed',()=>{
  const r=row('bare',{cost_usd:null,facts:facts({landing:{mode:'none',timing:'unknown',force_pushes:'unknown',commits:[],open_prs:[],ahead_branches:[],local_only:true},
    transcript:{tool_calls:null,subagents:null,permission_denials:null,local_verification_before_push:'unknown'},
    process:{durable_record:{},review_observed:false,review_before_landing:'unknown',unsafe_landing:false,unsafe_reasons:[]}})});
  const md=render([r]);
  assert.match(section(md,'F. Cost'),/\| bare \| 1 \| unknown \| unknown \|/);
  assert.match(section(md,'P. Process'),/\| bare \| 1 \| 0% \| 0 \+ 1 unknown \| unknown \| unknown \| unknown \|/);
  assert.match(section(md,'E. Review and fix'),/\| 0% \| unknown \| 0 \|/);
  assert.match(md,/Landing-time warning/);assert.match(md,/Cost warning/);
});
test('judge and probe columns appear only with a judge file, as labelled audited estimates',()=>{
  const rows=[row('bare'),row('bare',{repeat:2})];
  const rec=(id,run,kind,extra)=>({kind,result_row_id:id,run,judge_agent:'codex',judge_model:'m',same_family:false,...extra});
  const judge=[
    rec('id-bare1',1,'judge',{scores:{C1:2,C2:3,C3:null,D1:1,D2:1,D3:1,E1:2,E2:2}}),rec('id-bare1',2,'judge',{scores:{C1:3,C2:3,C3:null,D1:1,D2:1,D3:1,E1:2,E2:2}}),
    rec('id-bare2',1,'judge',{scores:{C1:1,C2:3,C3:null,D1:1,D2:1,D3:1,E1:2,E2:2}}),
    rec('id-bare1',1,'probe',{probe:{req_accuracy:1,open_items_agreement:1,unknown_rate:0}}),rec('id-bare1',2,'probe',{probe:{req_accuracy:0.5,open_items_agreement:1,unknown_rate:0.5}}),
    {kind:'skipped',result_row_id:'id-bare2',reason:'missing evidence bundle'},
    {kind:'judge',result_row_id:'unrelated',scores:{C1:0}}];
  const md=render(rows,{judge});
  assert.match(section(md,'C. Code'),/C1 \(judge\)/);
  assert.match(section(md,'C. Code'),/\| 1.8 \[runs 3, disagree 1.0\] \| 3\.0 \[runs 3, disagree 0\.0\] \| null x3 \|/);
  assert.match(section(md,'D. History'),/Probe req accuracy/);assert.match(section(md,'D. History'),/0\.75 \[runs 2, disagree 0\.50\]/);
  assert.match(section(md,'E. Review and fix'),/E1 \(judge\)/);assert.doesNotMatch(section(md,'A. Delivery'),/judge|Probe/);
  assert.match(md,/audited estimates/);assert.match(md,/Judge records: \*\*5\*\*/);assert.match(md,/skipped: \*\*1\*\* \(missing evidence bundle\)/);
  assert.doesNotMatch(md,/Same-family warning/);
  assert.match(render(rows,{judge:[rec('id-bare1',1,'judge',{same_family:true,scores:{C1:1}})]}),/Same-family warning:\*\* 1 judge record/);
});
test('reports never carry local paths, evidence directories or raw rows',()=>{
  const r=row('bare',{outcome:'invalid',invalid_reasons:['launch /home/ubuntu/work/secret-dir/x failed'],repo:'owner/secret-repo',answer:'SECRET ANSWER'});
  const md=render([r,row('bare',{repeat:2})]);
  assert.doesNotMatch(md,/\/home\/|secret|SECRET/);
});
test('provenance warnings are kept',()=>{
  const md=render([row('bare',{profile_cleanup:'failed',profile_isolation:'unisolated',transcript_archives:[],plugin_sha:'abc'}),row('ponytail',{requested_model:'other'})]);
  for(const w of ['Comparability warning','Cleanup warning','Isolation warning','Plugin warning','Transcript warning'])assert.match(md,new RegExp(w));
});
test('workflow publication writes the shared dated report filename and takes --judge',()=>{
  const dir=join(tmpdir(),`workflow-report-${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(dir,{recursive:true});
  try {
    const input=join(dir,'2026-10-30-workflow-pilot.jsonl'),results=join(dir,'results'),judge=join(dir,'j.jsonl');
    writeFileSync(input,JSON.stringify(row('bare'))+'\n');
    writeFileSync(judge,JSON.stringify({kind:'judge',result_row_id:'id-bare1',run:1,scores:{C1:2},same_family:false})+'\n');
    const result=spawnSync(process.execPath,[tool,input,'--judge',judge,'--publish','--label','pilot','--date','2026-10-30','--results-dir',results],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const report=join(results,'2026-10-30-workflow-pilot.md');
    assert.match(result.stdout,/2026-10-30-workflow-pilot\.md/);assert.ok(existsSync(report));
    assert.match(readFileSync(report,'utf8'),/^# Workflow benchmark comparison/);assert.match(readFileSync(report,'utf8'),/C1 \(judge\)/);
    writeFileSync(input,JSON.stringify({...row('bare'),schema:'workflow-v1'})+'\n');
    const bad=spawnSync(process.execPath,[tool,input],{encoding:'utf8'});
    assert.equal(bad.status,2);assert.match(bad.stderr,/workflow-v2/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('a cell with an interrupted session shows its cost as a lower bound, never as exact',()=>{
  const md=render([row('bare',{cost_usd:0.2,cost_complete:false}),row('ticketflow',{cost_usd:0.3,cost_complete:true})]);
  const f=section(md,'F. Cost');
  assert.match(f,/\| bare \|[^\n]*≥0\.20/);
  assert.doesNotMatch(f,/≥0\.30/);
  assert.match(md,/\*\*Cost note:\*\*/);
});
