import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess,terminateProcess} from '../lib/process.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const runner=fileURLToPath(new URL('../workflow-run.mjs',import.meta.url));
const wrapper=fileURLToPath(new URL('../run-all.mjs',import.meta.url));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^WORKFLOW_BENCH_/.test(k)));
const withTemp=(run)=>{
  const dir=mkdtempSync(join(tmpdir(),'workflow-dryrun-'));
  try{return run(dir)}finally{rmSync(dir,{recursive:true,force:true})}
};
const git=(dir,...args)=>spawnSync('git',['-c','user.name=test','-c','user.email=test@example.invalid',...args],{cwd:dir,encoding:'utf8'});
const ticketflowSource=(dir,{remote='https://github.com/livingc0de/ticketflow.git',detached=false,label='source'}={})=>{
  const source=join(dir,'ticketflow-'+label);
  mkdirSync(join(source,'core/scripts'),{recursive:true});
  writeFileSync(join(source,'core/scripts/runtime.mjs'),'export default {}\n');
  git(source,'init','-q','-b','main');
  git(source,'add','-A');git(source,'commit','-qm','source');git(source,'remote','add','origin',remote);
  if(detached)git(source,'checkout','--detach','-q');
  return {source,sha:git(source,'rev-parse','HEAD').stdout.trim()};
};
const pluginSource=(dir,arm='ponytail')=>{
  const source=join(dir,arm);
  for(const native of ['.claude-plugin','.codex-plugin']){
    mkdirSync(join(source,native),{recursive:true});
    writeFileSync(join(source,native,'plugin.json'),JSON.stringify({name:arm})+'\n');
  }
  git(source,'init','-q','-b','main');
  const remote=arm==='ponytail'?'https://github.com/DietrichGebert/ponytail.git':'https://github.com/obra/superpowers.git';
  git(source,'add','-A');git(source,'commit','-qm','plugin');git(source,'remote','add','origin',remote);
  git(source,'checkout','--detach','-q');
  return {source,sha:git(source,'rev-parse','HEAD').stdout.trim()};
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
test('Claude workflow plugin arms reach the remote-write gate without a plugin opt-in',()=>withTemp(dir=>{
  const plugin=pluginSource(dir),file=join(dir,'runs.jsonl');
  const base=[runner,'--agent','claude','--model','benchmark-test-model','--owner','example-benchmark-org',
    '--arms','ponytail','--scenarios','W1','--repeats','1','--out',file,'--ponytail-source',plugin.source,'--execute'];
  let result=spawnSync(process.execPath,base,{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,2,result.stderr);assert.match(result.stderr,/allow-github-writes/);
  assert.ok(!existsSync(file));assert.ok(!existsSync(file+'.state.json'));
}));
test('workflow Claude plugin preflight rejects a CLI without native plugin loading before GitHub setup',()=>withTemp(dir=>{
  const plugin=pluginSource(dir),file=join(dir,'runs.jsonl'),bin=join(dir,'bin'),ghLog=join(dir,'gh.log');
  mkdirSync(bin);
  const claude=join(bin,'claude');
  writeFileSync(claude,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo fake-claude; exit 0; fi\necho --some-other-option\n');
  writeFileSync(join(bin,'gh'),'#!/bin/sh\necho called >> "$GH_PREFLIGHT_LOG"\nexit 1\n');
  chmodSync(claude,0o755);chmodSync(join(bin,'gh'),0o755);
  const args=[runner,'--agent','claude','--model','benchmark-test-model','--owner','example-benchmark-org',
    '--arms','ponytail','--scenarios','W1','--repeats','1','--out',file,'--ponytail-source',plugin.source,
    '--execute','--allow-github-writes'];
  const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:{...env,PATH:bin+':'+process.env.PATH,
    WORKFLOW_BENCH_SETUP_TOKEN:'setup-token',WORKFLOW_BENCH_AGENT_TOKEN:'agent-token',GH_PREFLIGHT_LOG:ghLog},timeout:30000});
  assert.equal(result.status,2,result.stderr);assert.match(result.stderr,/does not advertise --plugin-dir/);
  assert.ok(!existsSync(file));assert.ok(!existsSync(file+'.state.json'));assert.ok(!existsSync(ghLog));
}));
test('Codex Ponytail workflow preflight rejects missing hook trust bypass before GitHub writes',()=>withTemp(dir=>{
  const plugin=pluginSource(dir),file=join(dir,'runs.jsonl'),bin=join(dir,'bin'),ghLog=join(dir,'gh.log');
  mkdirSync(bin);
  const codex=join(bin,'codex');
  writeFileSync(codex,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo fake-codex; exit 0; fi\necho "codex exec help without hook support"\n');
  writeFileSync(join(bin,'gh'),'#!/bin/sh\necho called >> "$GH_PREFLIGHT_LOG"\nexit 1\n');
  chmodSync(codex,0o755);chmodSync(join(bin,'gh'),0o755);
  const args=[runner,'--agent','codex','--model','benchmark-test-model','--owner','example-benchmark-org',
    '--arms','ponytail','--scenarios','W1','--repeats','1','--out',file,'--ponytail-source',plugin.source,
    '--execute','--allow-github-writes','--allow-danger-full-access'];
  const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:{...env,PATH:bin+':'+process.env.PATH,
    WORKFLOW_BENCH_SETUP_TOKEN:'setup-token',WORKFLOW_BENCH_AGENT_TOKEN:'agent-token',GH_PREFLIGHT_LOG:ghLog},timeout:30000});
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/--dangerously-bypass-hook-trust/);
  assert.ok(!existsSync(file));assert.ok(!existsSync(file+'.state.json'));assert.ok(!existsSync(ghLog));
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
test('TicketFlow workflow sources must be clean and reproducibly pinned',()=>withTemp(dir=>{
  const {source,sha}=ticketflowSource(dir), file=join(dir,'runs.jsonl');
  const base=[runner,'--agent','claude','--model','benchmark-test-model','--owner','example-benchmark-org',
    '--arms','ticketflow','--scenarios','W1','--repeats','1','--out',file,'--ticketflow-source',source];
  let result=spawnSync(process.execPath,[...base,'--ticketflow-sha',sha],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PLAN W1\|ticketflow\|1/);
  result=spawnSync(process.execPath,base,{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,2);assert.match(result.stderr,/detached or pinned/);
  result=spawnSync(process.execPath,[...base,'--ticketflow-sha','0'.repeat(40)],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,2);assert.match(result.stderr,/does not match expected/);
  const wrong=ticketflowSource(dir,{remote:'https://example.invalid/ticketflow.git',label:'wrong'});
  result=spawnSync(process.execPath,[...base.slice(0,-1),wrong.source,'--ticketflow-sha',wrong.sha],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,2);assert.match(result.stderr,/origin must be/);
  const pinned=ticketflowSource(dir,{detached:true,label:'detached'});
  result=spawnSync(process.execPath,[...base.slice(0,-1),pinned.source],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,0,result.stderr);
}));
test('process termination escalates an uncooperative child after a bounded grace period',async()=>{
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{detached:process.platform!=='win32'});
  await once(child,'spawn');
  await new Promise((resolve)=>setTimeout(resolve,100));
  let escalated=false;
  const clear=terminateProcess(child,{graceMs:50,onEscalate:()=>{escalated=true}});
  await Promise.race([once(child,'close'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('child did not terminate')),2000))]);
  clear();
  assert.equal(escalated,true);
});
test('runProcess waits for bounded escalation instead of resolving on SIGTERM',async()=>{
  const result=await runProcess(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{timeoutMs:50,graceMs:50});
  assert.equal(result.timedOut,true);
  assert.equal(result.signal,'SIGKILL');
});
