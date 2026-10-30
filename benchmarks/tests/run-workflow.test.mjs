import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess,signalProcess,terminateProcess} from '../lib/process.mjs';
import {makeProfile} from '../workflow/profile.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const runner=fileURLToPath(new URL('../run-workflow.mjs',import.meta.url));
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
const args=(file,selected='W1',repeats='1',arms='bare')=>[runner,'--agent','claude','--model','benchmark-test-model',
  '--owner','example-benchmark-org','--arms',arms,'--scenarios',selected,'--repeats',repeats,'--out',file];
test('unisolated Claude workflow profiles preserve the approved config directory',()=>withTemp(dir=>{
  const previousConfig=process.env.CLAUDE_CONFIG_DIR,previousToken=process.env.WORKFLOW_BENCH_AGENT_TOKEN;
  process.env.CLAUDE_CONFIG_DIR=join(dir,'approved-claude');
  process.env.WORKFLOW_BENCH_AGENT_TOKEN='test-only';
  try {
    const profile=makeProfile('claude','bare',dir,null,'unisolated');
    assert.equal(profile.env.CLAUDE_CONFIG_DIR,process.env.CLAUDE_CONFIG_DIR);
  } finally {
    if(previousConfig===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=previousConfig;
    if(previousToken===undefined)delete process.env.WORKFLOW_BENCH_AGENT_TOKEN;else process.env.WORKFLOW_BENCH_AGENT_TOKEN=previousToken;
  }
}));
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
const evaluatorFingerprint=()=>{
  const hash=createHash('sha256');
  for(const path of ['run-workflow.mjs','workflow/scenarios.mjs','workflow/scenarios-extra.mjs','workflow/sandbox.mjs',
    'workflow/profile.mjs','workflow/check.mjs','workflow/outcome.mjs','lib/integrity.mjs',
    'lib/profile-auth.mjs','lib/process.mjs','lib/transcripts.mjs']){
    hash.update(path);hash.update('\0');hash.update(readFileSync(join(root,'benchmarks',path)));
  }
  return hash.digest('hex');
};
const resumeFixture=(dir,outcome,invalid_reasons=[])=>{
  const file=join(dir,'runs.jsonl'),cell={id:'W1',arm:'bare',repeat:1,key:'W1|bare|1'};
  const fingerprint=evaluatorFingerprint();
  const signature=JSON.stringify({p:[cell],agent:'claude',model:'benchmark-test-model',effort:null,
    sourceShas:{},sourceMeta:{},fingerprint});
  writeFileSync(file,JSON.stringify({scenario:'W1',arm:'bare',repeat:1,outcome,invalid_reasons,
    agent:'claude',agent_version:'fake',eval_fingerprint:fingerprint,result_row_id:'previous-row',
    requested_model:'benchmark-test-model',requested_effort:null,source_sha:null})+'\n');
  writeFileSync(file+'.state.json',JSON.stringify({signature,runId:'testrun',cells:{
    [cell.key]:{repo:'example-benchmark-org/tfwf-testrun-w1-bare-1',phase:'completed',
      result_row_id:'previous-row'}}}));
  return file;
};
test('resume can run a later scenario in the same cumulative workflow state',()=>withTemp(dir=>{
  const file=resumeFixture(dir,'failure');
  const result=spawnSync(process.execPath,[...args(file,'W2'),'--resume'],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/"scheduled_cells": 2/);
  assert.match(result.stdout,/"new_cells": 1/);
  assert.match(result.stdout,/"completed": 0/);
  assert.match(result.stdout,/"pending": 1/);
  assert.match(result.stdout,/PLAN W2\|bare\|1/);
  assert.doesNotMatch(result.stdout,/PLAN W1\|bare\|1/);
}));
test('resume can extend repeats without rerunning the existing repeat',()=>withTemp(dir=>{
  const file=resumeFixture(dir,'failure');
  const result=spawnSync(process.execPath,[...args(file,'W1','2'),'--resume'],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/"scheduled_cells": 2/);
  assert.match(result.stdout,/"new_cells": 1/);
  assert.match(result.stdout,/"completed": 1/);
  assert.match(result.stdout,/"pending": 1/);
  assert.match(result.stdout,/PLAN W1\|bare\|2/);
  assert.doesNotMatch(result.stdout,/PLAN W1\|bare\|1/);
}));
test('resume can add an arm with its pinned source without rerunning existing cells',()=>withTemp(dir=>{
  const file=resumeFixture(dir,'failure'),plugin=ticketflowSource(dir);
  const result=spawnSync(process.execPath,[...args(file,'W2','1','bare,ticketflow'),
    '--ticketflow-source',plugin.source,'--ticketflow-sha',plugin.sha,'--resume'],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/"scheduled_cells": 3/);
  assert.match(result.stdout,/"new_cells": 2/);
  assert.match(result.stdout,/"pending": 2/);
  assert.match(result.stdout,/PLAN W2\|bare\|1/);
  assert.match(result.stdout,/PLAN W2\|ticketflow\|1/);
  assert.doesNotMatch(result.stdout,/PLAN W1\|bare\|1/);
}));
test('resume retries invalid measurements but never reruns an ordinary framework failure',()=>withTemp(dir=>{
  const file=resumeFixture(dir,'invalid',['transcript_archive_failed']);
  const pending=spawnSync(process.execPath,[...args(file),'--resume'],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(pending.status,0,pending.stderr);
  assert.match(pending.stdout,/"invalid_to_retry": 1/);
  assert.match(pending.stdout,/"pending": 1/);
  assert.match(pending.stdout,/PLAN W1\|bare\|1/);
  writeFileSync(file,readFileSync(file,'utf8').replace('"invalid"','"failure"'));
  const completed=spawnSync(process.execPath,[...args(file),'--resume'],{cwd:root,encoding:'utf8',env,timeout:30000});
  assert.equal(completed.status,0,completed.stderr);
  assert.match(completed.stdout,/"completed": 1/);
  assert.match(completed.stdout,/"pending": 0/);
}));
test('failed cleanup requires explicit acknowledgment before paying for invalid retry',()=>withTemp(dir=>{
  const file=resumeFixture(dir,'invalid',['plugin_cleanup_failed']),ghLog=join(dir,'gh.log'),bin=join(dir,'bin');
  mkdirSync(bin);
  writeFileSync(join(bin,'gh'),'#!/bin/sh\necho called >> "$GH_PREFLIGHT_LOG"\nexit 1\n');
  chmodSync(join(bin,'gh'),0o755);
  const run=spawnSync(process.execPath,[...args(file),'--resume','--execute','--allow-github-writes'],
    {cwd:root,encoding:'utf8',env:{...env,PATH:bin+':'+process.env.PATH,GH_PREFLIGHT_LOG:ghLog},timeout:30000});
  assert.equal(run.status,2,run.stderr);
  assert.match(run.stderr,/--acknowledge-plugin-cleanup/);
  assert.ok(!existsSync(ghLog));
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
  await new Promise((resolve)=>setTimeout(resolve,300));
  let escalated=false;
  const clear=terminateProcess(child,{graceMs:100,onEscalate:()=>{escalated=true}});
  await Promise.race([once(child,'close'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('child did not terminate')),2000))]);
  clear();
  assert.equal(escalated,true);
});
test('process termination escalates after the leader exits while a descendant retains the pipes',async()=>{
  if(process.platform==='win32')return;
  const descendant="process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
  const leader=`const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`;
  const child=spawn(process.execPath,['-e',leader],{detached:true});
  await once(child,'spawn');
  await new Promise(resolve=>setTimeout(resolve,300));
  let escalated=false;
  const clear=terminateProcess(child,{graceMs:100,onEscalate:()=>{escalated=true}});
  try {
    await Promise.race([once(child,'close'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('descendant kept the pipes open')),2000))]);
  } finally {
    clear();
    signalProcess(child,'SIGKILL');
  }
  assert.equal(escalated,true);
});
test('runProcess waits for bounded escalation instead of resolving on SIGTERM',async()=>{
  const result=await runProcess(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{timeoutMs:200,graceMs:100});
  assert.equal(result.timedOut,true);
  assert.equal(result.signal,'SIGKILL');
});
test('runProcess records stdin stream errors without losing the child close result',async()=>{
  if(process.platform==='win32')return;
  const result=await runProcess('true',[],{input:'hello'.repeat(1024*1024)});
  assert.equal(result.status,0);
  assert.equal(result.error?.code,'EPIPE');
});
