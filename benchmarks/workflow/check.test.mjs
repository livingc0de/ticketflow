import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkRuns, findCandidateCheckout } from './check.mjs';

const pr={headRefOid:'abc123',mergedAt:'2026-10-31T12:00:00Z'};
const before='2026-10-31T11:00:00Z',after='2026-10-31T13:00:00Z';
const run=(id,overrides={})=>({id,head_sha:pr.headRefOid,name:'bench',status:'completed',conclusion:'success',updated_at:before,...overrides});
const job=(name,overrides={})=>({head_sha:pr.headRefOid,name,status:'completed',conclusion:'success',completed_at:before,...overrides});
const fixture=(runs,jobsByRun)=>{
  const calls=[];
  const request=(path)=>{
    calls.push(path);
    if(path.includes('/actions/runs?'))return {total_count:runs.length,workflow_runs:runs};
    const id=Number(path.match(/\/actions\/runs\/(\d+)\/jobs/)?.[1]);
    const jobs=jobsByRun[id]??[];
    return {total_count:jobs.length,jobs};
  };
  return {calls,request};
};

test('Actions workflow jobs replace Checks API and find the tests job in the bench workflow',()=>{
  const f=fixture([run(1,{name:'bench'})],{1:[job('tests')]});
  const result=checkRuns('org/repo',pr,null,f.request);
  assert.equal(result.pass,true);
  assert.match(result.reason,/completed\/success/);
  assert.ok(f.calls[0].includes('/actions/runs?head_sha=abc123'));
  assert.ok(f.calls[1].includes('/actions/runs/1/jobs?filter=all'));
  assert.ok(f.calls.every(path=>!path.includes('/check-runs')));
});

test('a missing tests job does not count as CI success',()=>{
  const f=fixture([run(1)],{1:[job('lint')]});
  const result=checkRuns('org/repo',pr,null,f.request);
  assert.equal(result.pass,false);
  assert.equal(result.reason,'required neutral GitHub Actions test missing');
});

test('a pre-merge failed job blocks delivery but a post-merge failure does not',()=>{
  const pre=fixture([run(1,{conclusion:'failure'})],{1:[job('tests',{conclusion:'failure'})]});
  const failed=checkRuns('org/repo',pr,null,pre.request);
  assert.equal(failed.pass,false);
  assert.match(failed.reason,/failure/);

  const post=fixture([run(2),run(3,{conclusion:'failure',updated_at:after})],{
    2:[job('tests')],3:[job('tests',{conclusion:'failure',completed_at:after})]});
  const postMerge=checkRuns('org/repo',pr,null,post.request);
  assert.equal(postMerge.pass,true);
});

test('a rerun with an earlier failed job remains invalid',()=>{
  const f=fixture([run(1,{conclusion:'failure'}),run(2)],{
    1:[job('tests',{conclusion:'failure'})],2:[job('tests')]});
  const result=checkRuns('org/repo',pr,null,f.request);
  assert.equal(result.pass,false);
  assert.match(result.reason,/other failing checks: tests/);
});

test('incomplete or malformed Actions listings fail closed',()=>{
  const incomplete=checkRuns.bind(null,'org/repo',pr,null,(path)=>{
    if(path.includes('/actions/runs?'))return {total_count:2,workflow_runs:[run(1)]};
    return {total_count:0,jobs:[]};
  });
  assert.throws(incomplete,/workflow run listing is incomplete/);

  const malformed=checkRuns.bind(null,'org/repo',pr,null,(path)=>{
    if(path.includes('/actions/runs?'))return {total_count:1,workflow_runs:[run(1)]};
    return {total_count:1,jobs:[{name:'tests',status:'completed',conclusion:'success',completed_at:before}]};
  });
  assert.throws(malformed,/job response is malformed/);
});

test('candidate scoring selects the agent worktree instead of the untouched base clone',()=>{
  const dir=mkdtempSync(join(tmpdir(),'workflow-candidate-')),worktree=join(dir,'agent-worktree');
  try{
    execFileSync('git',['init','-q','-b','main'],{cwd:dir});
    execFileSync('git',['config','user.name','test'],{cwd:dir});
    execFileSync('git',['config','user.email','test@example.invalid'],{cwd:dir});
    writeFileSync(join(dir,'base.txt'),'base\n');
    execFileSync('git',['add','base.txt'],{cwd:dir});
    execFileSync('git',['commit','-qm','base'],{cwd:dir});
    execFileSync('git',['worktree','add','-q','-b','feature',worktree],{cwd:dir});
    writeFileSync(join(worktree,'candidate.txt'),'candidate\n');
    execFileSync('git',['add','candidate.txt'],{cwd:worktree});
    execFileSync('git',['commit','-qm','candidate'],{cwd:worktree});
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:worktree,encoding:'utf8'}).trim();
    assert.equal(findCandidateCheckout(dir,[{headRefOid:head,createdAt:'2026-10-31T00:00:00Z'}]),worktree);
    assert.equal(findCandidateCheckout(dir,[]),dir);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
