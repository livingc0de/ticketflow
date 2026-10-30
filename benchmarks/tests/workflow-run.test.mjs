import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const runner=fileURLToPath(new URL('../workflow-run.mjs',import.meta.url));
const wrapper=fileURLToPath(new URL('../run-all.mjs',import.meta.url));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^WORKFLOW_BENCH_/.test(k)));
const withTemp=(run)=>{
  const dir=mkdtempSync(join(tmpdir(),'workflow-dryrun-'));
  try{return run(dir)}finally{rmSync(dir,{recursive:true,force:true})}
};
const args=(file)=>[runner,'--agent','claude','--model','benchmark-test-model',
  '--owner','example-benchmark-org','--arms','bare','--scenarios','W1','--repeats','1','--out',file];
test('workflow dry-run makes no remote resources, result files or paid CLI calls',()=>withTemp(dir=>{
  const file=join(dir,'runs.jsonl');
  const result=spawnSync(process.execPath,args(file),{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/DRY RUN/);
  assert.match(result.stdout,/PLAN W1\|bare\|1/);
  assert.ok(!existsSync(file));
  assert.ok(!existsSync(file+'.state.json'));
}));
test('paid invocation without remote-write consent is rejected before token checks',()=>withTemp(dir=>{
  const file=join(dir,'runs.jsonl');
  const result=spawnSync(process.execPath,[...args(file),'--execute'],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,2);
  assert.match(result.stderr,/allow-github-writes/);
  assert.ok(!existsSync(file));
  assert.ok(!existsSync(file+'.state.json'));
}));
test('wrapper runs workflow dry-run only without execute',()=>withTemp(dir=>{
  const file=join(dir,'runs.jsonl'), config=join(dir,'plan.json');
  writeFileSync(config,JSON.stringify({workflow:args(file).slice(1)}));
  const result=spawnSync(process.execPath,[wrapper,'--config',config,'--suite','workflow'],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/DRY RUN/);
  assert.ok(!existsSync(file));
}));
test('wrapper forbids execute embedded in plan',()=>withTemp(dir=>{
  const config=join(dir,'plan.json');
  writeFileSync(config,JSON.stringify({workflow:[...args(join(dir,'r.jsonl')).slice(1),'--execute']}));
  const result=spawnSync(process.execPath,[wrapper,'--config',config,'--suite','workflow'],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,2);
  assert.match(result.stderr,/--execute/);
}));
