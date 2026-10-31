import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkRuns, checkoutPrHead, fallbackEvidence, findCandidateCheckout, scoreDelivery } from './check.mjs';
import { fixture as scenarioFiles } from './scenarios.mjs';

const pr={number:7,headRefOid:'abc123',headRefName:'feature',mergedAt:'2026-10-31T12:00:00Z'};
const before='2026-10-31T11:00:00Z',after='2026-10-31T13:00:00Z';
const run=(id,overrides={})=>({id,head_sha:pr.headRefOid,name:'bench',status:'completed',conclusion:'success',updated_at:before,...overrides});
const job=(name,overrides={})=>({head_sha:pr.headRefOid,name,status:'completed',conclusion:'success',completed_at:before,...overrides});
const fixture=(runs,jobsByRun,branchRuns=null,allPullRuns=null)=>{
  const calls=[];
  const request=(path)=>{
    calls.push(path);
    if(path.includes('/actions/runs?head_sha='))return {total_count:runs.length,workflow_runs:runs};
    if(path.includes('/actions/runs?event=pull_request&branch='))return {total_count:(branchRuns??[]).length,workflow_runs:branchRuns??[]};
    if(path.includes('/actions/runs?event=pull_request&per_page='))return {total_count:(allPullRuns??[]).length,workflow_runs:allPullRuns??[]};
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
  assert.ok(f.calls.some(path=>path.includes('/actions/runs/1/jobs?filter=latest')));
  assert.ok(f.calls.every(path=>!path.includes('/check-runs')));
});

test('pull-request Actions runs on a temporary merge SHA are matched through the exact PR head',()=>{
  const mergeSha='b'.repeat(40);
  const f=fixture([],{
    9:[job('tests',{head_sha:mergeSha})],
  },[run(9,{head_sha:mergeSha,event:'pull_request',pull_requests:[{number:7,head:{sha:pr.headRefOid}}]})]);
  const result=checkRuns('org/repo',pr,null,f.request);
  assert.equal(result.pass,true);
  assert.ok(f.calls.some(path=>path.includes('/actions/runs?event=pull_request&branch=feature&per_page=100')));
});

test('workflow-run lookup retries without the branch filter when GitHub ignores it',()=>{
  const mergeSha='c'.repeat(40);
  const f=fixture([],{
    10:[job('tests',{head_sha:mergeSha})],
  },[],[run(10,{head_sha:mergeSha,event:'pull_request',pull_requests:[{number:7,head:{sha:pr.headRefOid}}]})]);
  const result=checkRuns('org/repo',pr,null,f.request);
  assert.equal(result.pass,true);
  assert.ok(f.calls.some(path=>path.includes('/actions/runs?event=pull_request&per_page=100')));
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

test('a framework gate still running at merge blocks delivery',()=>{
  const started=new Date(Date.parse(pr.mergedAt)-60_000).toISOString();
  const f=fixture([run(1)],{1:[job('tests'),job('Verify',{status:'in_progress',conclusion:null,completed_at:null,started_at:started})]});
  const result=checkRuns('org/repo',pr,null,f.request);
  assert.equal(result.pass,false);
  assert.match(result.reason,/unfinished at merge: Verify/);
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

test('fallback evidence distinguishes an available refusal from a local gate',()=>{
  const refusal=(status,jobs=[])=>path=>{
    if(path.includes('/commits/abc123/status'))return {sha:'abc123',statuses:status};
    if(path.includes('/issues/7/comments'))return [];
    if(path.includes('/actions/runs?'))return {total_count:1,workflow_runs:[run(1,{conclusion:'failure'})]};
    return {total_count:jobs.length,jobs};
  };
  const available=fallbackEvidence('org/repo',{number:7,headRefOid:'abc123'},null,refusal([]));
  assert.deepEqual(available,{allowed:true,attempted:false,posted:false,success:false,state:null,description:null,local_comments:0});

  const passed=fallbackEvidence('org/repo',{number:7,headRefOid:'abc123'},null,refusal([
    {context:'CI / Gate',state:'success',description:'Local run on runner (Linux), npm test'}
  ]));
  assert.equal(passed.allowed,true);
  assert.equal(passed.attempted,true);
  assert.equal(passed.posted,true);
  assert.equal(passed.success,true);

  // GitHub sets started_at even on a refused job (runner_id 0, no runner_name, no steps): only a runner or a step proves execution
  const evidence=extra=>fallbackEvidence('org/repo',{number:7,headRefOid:'abc123'},null,refusal([], [job('Verify',extra)])).allowed;
  assert.equal(evidence({created_at:before,started_at:before,runner_id:0,runner_name:'',steps:[]}),true);
  assert.equal(evidence({runner_id:42}),false);
  assert.equal(evidence({runner_id:0,runner_name:'GitHub Actions 1000003001'}),false);
  assert.equal(evidence({steps:[{}]}),false);
});

test('checkRuns reads the latest job attempts, so a re-run that passed is not a failure; fallback evidence still reads all',()=>{
  const failed=job('tests',{conclusion:'failure'}),passed=job('tests');
  const request=path=>{
    if(path.includes('/actions/runs?'))return {total_count:1,workflow_runs:[run(1)]};
    const jobs=path.includes('filter=latest')?[passed]:[failed,passed];
    return {total_count:jobs.length,jobs};
  };
  assert.equal(checkRuns('org/repo',pr,null,request).pass,true);
});

test('an unrelated run on the head does not hide the pull-request run on the merge SHA',()=>{
  const mergeSha='b'.repeat(40);
  const f=fixture([run(1,{name:'lint'})],{1:[job('lint')],9:[job('tests',{conclusion:'failure',head_sha:mergeSha})]},
    [run(9,{conclusion:'failure',head_sha:mergeSha,event:'pull_request',pull_requests:[{number:7,head:{sha:pr.headRefOid}}]})]);
  const result=checkRuns('org/repo',pr,null,f.request);
  assert.equal(result.pass,false);
  assert.match(result.reason,/failure/);
  assert.ok(f.calls.some(path=>path.includes('/actions/runs/9/jobs')),f.calls.join('\n'));
});

test('fallback evidence accepts a temporary merge-SHA refusal and rejects incomplete jobs',()=>{
  const mergeSha='d'.repeat(40);
  const refusal=(jobs,total_count=jobs.length)=>path=>{
    if(path.includes('/commits/abc123/status'))return {sha:'abc123',statuses:[]};
    if(path.includes('/issues/7/comments'))return [];
    if(path.includes('/actions/runs?'))return {total_count:1,workflow_runs:[run(1,{head_sha:mergeSha,event:'pull_request',conclusion:'failure',pull_requests:[{number:7,head:{sha:pr.headRefOid}}]})]};
    return {total_count,jobs};
  };
  const available=fallbackEvidence('org/repo',{number:7,headRefOid:'abc123'},null,refusal([job('Verify',{head_sha:mergeSha})]));
  assert.equal(available.allowed,true);
  assert.throws(()=>fallbackEvidence('org/repo',{number:7,headRefOid:'abc123'},null,refusal([job('Verify',{head_sha:mergeSha})],2)),/incomplete/);
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
    assert.equal(findCandidateCheckout(dir,[{headRefOid:'e'.repeat(40),createdAt:'2026-10-31T00:00:00Z'}]),null);
    assert.equal(findCandidateCheckout(dir,[]),null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
/** A bare origin holding main plus a PR head that exists only under refs/pull/1/head (its branch was deleted), and a clone left on main. */
const mergedFlow=(root)=>{
  const origin=join(root,'origin.git'),seed=join(root,'seed'),clone=join(root,'clone');
  mkdirSync(seed);git(seed,'init','-q','-b','main');git(seed,'config','user.name','test');git(seed,'config','user.email','t@example.invalid');
  for(const [name,text] of Object.entries(scenarioFiles('W1'))){mkdirSync(join(seed,name,'..'),{recursive:true});writeFileSync(join(seed,name),text);}
  git(seed,'add','-A');git(seed,'commit','-qm','base');
  git(seed,'checkout','-q','-b','feature');writeFileSync(join(seed,'pr-marker.txt'),'pr\n');git(seed,'add','-A');git(seed,'commit','-qm','pr');
  const head=git(seed,'rev-parse','HEAD');
  git(root,'init','-q','--bare','-b','main',origin);git(seed,'push','-q',origin,'main','feature:refs/pull/1/head');
  git(root,'clone','-q',origin,clone);
  return {origin,clone,head};
};

test('the exact newest PR head is checked out in a temporary worktree that is removed afterwards',()=>{
  const root=mkdtempSync(join(tmpdir(),'workflow-pr-head-test-'));
  try{
    const {clone,head}=mergedFlow(root);
    assert.equal(findCandidateCheckout(clone,[{number:1,headRefOid:head}]),null);   // the clone sits on main: no worktree holds the head
    const checkout=checkoutPrHead(clone,[{number:1,headRefOid:'0'.repeat(40),createdAt:'2026-10-30T00:00:00Z'},{number:1,headRefOid:head,createdAt:'2026-10-31T00:00:00Z'}]);
    assert.equal(git(checkout.path,'rev-parse','HEAD'),head);
    assert.ok(existsSync(join(checkout.path,'pr-marker.txt')));
    checkout.remove();
    assert.ok(!existsSync(checkout.path));
    assert.equal(git(clone,'worktree','list','--porcelain').split('\n').filter(l=>l.startsWith('worktree ')).length,1);
    checkout.remove();   // a second removal never throws
    assert.equal(checkoutPrHead(clone,[]),null);
    assert.throws(()=>checkoutPrHead(clone,[{number:2,headRefOid:'f'.repeat(40)}]));   // an unfetchable head is infrastructure
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('scoring evaluates the PR head after the agent merged and deleted its worktree, and the agent checkout when there is no PR',()=>{
  const root=mkdtempSync(join(tmpdir(),'workflow-score-test-')),bin=join(root,'bin');
  try{
    const {clone,head}=mergedFlow(root);
    mkdirSync(bin);
    writeFileSync(join(bin,'gh'),`#!/bin/sh
if [ "$1" = "pr" ]; then printf '%s\\n' "$PRS"; exit 0; fi
case "$*" in
  *--slurp*) echo '[[]]' ;;
  *commits/*/status*) printf '{"sha":"%s","statuses":[]}\\n' "$PR_HEAD" ;;
  *) echo '{"total_count":0,"workflow_runs":[]}' ;;
esac
`);chmodSync(join(bin,'gh'),0o755);
    const score=(prs)=>scoreDelivery({repo:'org/repo',id:'W1',issues:[],candidateDir:clone,
      env:{...process.env,PATH:bin+':'+process.env.PATH,PRS:JSON.stringify(prs),PR_HEAD:head}});
    const open=score([{number:1,headRefOid:head,headRefName:'feature',mergedAt:null,body:'',createdAt:'2026-10-31T00:00:00Z'}]);
    assert.equal(open.error,null);
    assert.equal(open.candidate.source,'pr-head');assert.equal(open.candidate.available,true);
    assert.equal(git(clone,'worktree','list','--porcelain').split('\n').filter(l=>l.startsWith('worktree ')).length,1);
    const none=score([]);
    assert.equal(none.error,null);
    assert.equal(none.candidate.source,'agent-checkout');assert.equal(none.candidate.correctness,false);   // an untouched checkout is an agent failure, not an invalid cell
    const missing=scoreDelivery({repo:'org/repo',id:'W1',issues:[],candidateDir:join(root,'gone'),env:{...process.env,PATH:bin+':'+process.env.PATH,PRS:'[]',PR_HEAD:head}});
    assert.match(missing.error,/candidate checkout is unavailable/);
    const unfetchable=score([{number:2,headRefOid:'f'.repeat(40),headRefName:'x',mergedAt:null,body:'',createdAt:'2026-10-31T00:00:00Z'}]);
    assert.match(unfetchable.error,/git .* failed/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
