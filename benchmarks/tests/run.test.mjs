import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const wrapper=fileURLToPath(new URL('../run.mjs',import.meta.url));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^WORKFLOW_BENCH_/.test(k)));
const withTemp=(run)=>{
  const dir=join(tmpdir(),`benchmark-run-${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(dir,{recursive:true});
  try{return run(dir)}finally{rmSync(dir,{recursive:true,force:true})}
};
const workflowArgs=(file)=>['--agent','claude','--model','benchmark-test-model','--owner','example-benchmark-org',
  '--arms','bare','--scenarios','W1','--repeats','1','--out',file];
const localArgs=(file)=>['--agent','claude','--model','benchmark-test-model','--arms','bare','--scenarios','L1','--repeats','1','--out',file];

test('run launches the requested workflow suite without execute',()=>withTemp(dir=>{
  const file=join(dir,'workflow.jsonl'),config=join(dir,'plan.json');
  writeFileSync(config,JSON.stringify({workflow:workflowArgs(file)}));
  const result=spawnSync(process.execPath,[wrapper,'--config',config,'--suite','workflow'],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/=== workflow benchmark DRY RUN ===/);
  assert.match(result.stdout,/PLAN W1\|bare\|1/);
  assert.ok(!existsSync(file));
}));

test('run defaults to both suites and launches local before workflow',()=>withTemp(dir=>{
  const local=join(dir,'local.jsonl'),workflow=join(dir,'workflow.jsonl'),config=join(dir,'plan.json');
  writeFileSync(config,JSON.stringify({local:localArgs(local),workflow:workflowArgs(workflow)}));
  const result=spawnSync(process.execPath,[wrapper,'--config',config],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/=== local benchmark DRY RUN ===/);
  assert.match(result.stdout,/=== workflow benchmark DRY RUN ===/);
  assert.match(result.stdout,/PLAN L1 bare rep=1/);
  assert.match(result.stdout,/PLAN W1\|bare\|1/);
  assert.ok(!existsSync(local));
  assert.ok(!existsSync(workflow));
}));

test('run forbids execute embedded in a plan',()=>withTemp(dir=>{
  const config=join(dir,'plan.json');
  writeFileSync(config,JSON.stringify({workflow:[...workflowArgs(join(dir,'r.jsonl')),'--execute']}));
  const result=spawnSync(process.execPath,[wrapper,'--config',config,'--suite','workflow'],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,2);
  assert.match(result.stderr,/--execute/);
}));
