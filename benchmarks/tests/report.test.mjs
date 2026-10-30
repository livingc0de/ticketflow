import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const wrapper=fileURLToPath(new URL('../report.mjs',import.meta.url));
const withTemp=(run)=>{
  const dir=join(tmpdir(),`benchmark-report-${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(dir,{recursive:true});
  try{return run(dir)}finally{rmSync(dir,{recursive:true,force:true})}
};
const localRow={scenario:'L1-trivial-copy',agent:'claude',agent_version:'test',requested_model:'test-model',model:'test-model',
  arm:'bare',variant:'bare',eval_fingerprint:'a'.repeat(64),evaluation_mode:'non-adversarial',profile_isolation:'isolated',
  sandbox_mode:'not-applicable',requested_effort:null,repeat:1,check:{pass:true},wall_s:1,cost_usd:0,tokens:{input_tokens:1,output_tokens:1},
  diff:{added:1,removed:0},deps_added:0,agent_exit:0,descendants:'unknown',result_row_id:'local-row',transcript_archive:'transcripts/local-row'};
const workflowRow={suite:'workflow',scenario:'W1',arm:'bare',agent:'claude',agent_version:'test',requested_model:'test-model',
  requested_effort:'high',eval_fingerprint:'a'.repeat(64),profile_isolation:'isolated',sandbox_mode:'not-applicable',check:{pass:true},
  outcome:'success',agent_exit:0,delivery:{functionality:true,pipeline:true,steps:{review_evidence:true,issue_tracking:true,latest_head_ci:true},
    process:{agent_created_issues:0,issues_closed_and_linked:0,plan_artifacts:[],planning:{project_changed_from_pre_agent_baseline:0},issue_coverage:1}},
  wall_s:1,cost_usd:0,descendants:'unknown',profile_cleanup:'ok',transcript_archives:['transcripts/workflow-row']};

test('report defaults to both suites and writes each configured report',()=>withTemp(dir=>{
  const localInput=join(dir,'local.jsonl'),workflowInput=join(dir,'workflow.jsonl');
  const localOutput=join(dir,'local.md'),workflowOutput=join(dir,'workflow.md'),config=join(dir,'plan.json');
  writeFileSync(localInput,JSON.stringify(localRow)+'\n');
  writeFileSync(workflowInput,JSON.stringify(workflowRow)+'\n');
  writeFileSync(config,JSON.stringify({local:[localInput,'--out',localOutput],workflow:[workflowInput,'--out',workflowOutput]}));
  const result=spawnSync(process.execPath,[wrapper,'--config',config],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/=== local report ===/);
  assert.match(result.stdout,/=== workflow report ===/);
  assert.ok(existsSync(localOutput));
  assert.ok(existsSync(workflowOutput));
}));

test('report can select one suite without requiring the other config entry',()=>withTemp(dir=>{
  const input=join(dir,'workflow.jsonl'),output=join(dir,'workflow.md'),config=join(dir,'plan.json');
  writeFileSync(input,JSON.stringify(workflowRow)+'\n');
  writeFileSync(config,JSON.stringify({workflow:[input,'--out',output]}));
  const result=spawnSync(process.execPath,[wrapper,'--config',config,'--suite','workflow'],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/=== workflow report ===/);
  assert.doesNotMatch(result.stdout,/=== local report ===/);
  assert.ok(existsSync(output));
}));
