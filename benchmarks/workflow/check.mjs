/**
 * Independent workflow evaluator. The agent never receives these hidden checks.
 * Treat review/plan evidence as observable proxies, never a guarantee of review quality.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scenarios } from './scenarios.mjs';

export const command=(bin,args,options={})=>{
  const env=options.env??{...process.env,...(process.env.WORKFLOW_BENCH_SETUP_TOKEN?{
    GH_TOKEN:process.env.WORKFLOW_BENCH_SETUP_TOKEN,GITHUB_TOKEN:process.env.WORKFLOW_BENCH_SETUP_TOKEN}:{})};
  const out=spawnSync(bin,args,{encoding:'utf8',timeout:options.timeout??120000,maxBuffer:16*1024*1024,cwd:options.cwd,env});
  if(out.error||out.status!==0)throw Error(bin+' '+args.slice(0,4).join(' ')+' failed: '+
    String(out.stderr||out.error?.message||out.status).slice(0,500));
  return out.stdout.trim();
};
const api=(path,env)=>JSON.parse(command('gh',['api',path],{env}));
const ghjson=(args,env)=>JSON.parse(command('gh',args,{env}));
const all=(repo,endpoint,env)=>{ // All pages or fail, rather than silently scoring partial evidence.
  const separator=endpoint.includes('?')?'&':'?';
  const data=ghjson(['api','--paginate','--slurp','repos/'+repo+'/'+endpoint+separator+'per_page=100'],env);
  if(!Array.isArray(data)||!data.every(Array.isArray))throw Error('GitHub pagination response invalid for '+endpoint);
  return data.flat();
};
export const pulls=(repo,env)=>ghjson(['pr','list','-R',repo,'--state','all',
  '--json','number,headRefOid,mergedAt,body,headRefName,createdAt','--limit','100'],env);
export const checkpoint=(repo)=>pulls(repo).some(p=>!p.mergedAt);
/** A W5 checkpoint must contain product changes pushed remotely, not just a named branch.
 * This is a trigger, not proof that the subsequent agent reused the work. */
export function meaningfulCheckpoint({branches=[],prs=[],compares={}}={}) {
  if(prs.some(p=>p.mergedAt))return false;
  return branches.some(b=>b.name!=='main' && compares[b.name]?.ahead_by>0 &&
    compares[b.name]?.files?.some(f=>/^(?:src|test)\//.test(f.filename)));
}
const textLinks=(n,body)=>new RegExp('(?:#|issues/)'+n+'(?!\\d)').test(body);
const isMerged=(p)=>Boolean(p.mergedAt);
const relevant=(name)=>/(?:^|\/)(?:plans?|design|decisions|docs\/architecture)\/.*\.md$/i.test(name);
export const projectSnapshot=(repo,n,env)=>{
  try {
    const data=ghjson(['issue','view',String(n),'-R',repo,'--json','projectItems'],env);
    return {readable:true,items:data.projectItems??[]};
  } catch {return {readable:false,items:[]};}
};
const issueSnapshot=(repo,seed,env)=>{
  const issues=all(repo,'issues?state=all',env).filter(i=>!i.pull_request);
  const records=issues.map(issue=>{
    const comments=all(repo,'issues/'+issue.number+'/comments',env);
    const timeline=all(repo,'issues/'+issue.number+'/events',env);
    const project=projectSnapshot(repo,issue.number,env);
    return {number:issue.number,title:issue.title,body:issue.body??'',state:issue.state,created_at:issue.created_at,
      seeded:seed.includes(issue.number),comments:comments.length,
      comments_after_creation:comments.filter(c=>c.created_at>issue.created_at).length,
      milestone:issue.milestone?.title??null,labels:(issue.labels??[]).map(x=>x.name),
      closed_at:issue.closed_at??null,
      events:timeline.map(e=>e.event),project};
  });
  return records;
};
const dependencyRefs=(text)=>[...String(text??'').matchAll(/\b(?:depends\s+on|blocked\s+by|blocks)\s*:?[ \t]*(?:#|issues\/)(\d+)\b/gi)].map(m=>Number(m[1]));
const actionable=(issue)=>{
  const title=String(issue.title??'').trim(),body=String(issue.body??'').trim();
  return title.length>=8&&body.length>=20&&title!==body&&
    !/^(?:task|issue|todo|work item|fix)\s*#?\d*$/i.test(title)&&
    /\b(?:add|build|create|design|document|fix|handle|implement|improve|migrate|remove|refactor|support|test|update|verify)\w*\b/i.test(title+' '+body);
};
const actionsFailures=new Set(['failure','timed_out','cancelled','action_required']);
const completeBefore=(timestamp,mergedAt)=>timestamp&&Number.isFinite(Date.parse(timestamp))&&Date.parse(timestamp)<=mergedAt;
const page=(response,key,label)=>{
  if(!response||!Array.isArray(response[key])||!Number.isSafeInteger(response.total_count)||response.total_count<0)
    throw Error('GitHub Actions '+label+' response is malformed');
  if(response.total_count>response[key].length)
    throw Error('GitHub Actions '+label+' listing is incomplete');
  return response[key];
};
export function checkRuns(repo,pr,env,request=api){
  if(!pr?.headRefOid||!pr?.mergedAt)return {pass:false,reason:'no merged PR and final head'};
  const mergedAt=Date.parse(pr.mergedAt);
  if(!Number.isFinite(mergedAt))throw Error('merged PR has an invalid merge timestamp');
  const runs=page(request('repos/'+repo+'/actions/runs?head_sha='+encodeURIComponent(pr.headRefOid)+'&per_page=100',env),
    'workflow_runs','workflow run');
  const checks=[],failures=[];
  for(const run of runs){
    if(run?.head_sha!==pr.headRefOid||!Number.isSafeInteger(run.id)||run.id<1)
      throw Error('GitHub Actions workflow run response is malformed');
    const jobs=page(request('repos/'+repo+'/actions/runs/'+run.id+'/jobs?filter=all&per_page=100',env),
      'jobs','jobs for workflow run '+run.id);
    for(const job of jobs){
      if(job?.head_sha!==pr.headRefOid||typeof job.name!=='string')
        throw Error('GitHub Actions job response is malformed');
      const evidence={name:job.name,status:job.status,conclusion:job.conclusion,completed_at:job.completed_at,
        workflow:run.name??null,run_id:run.id};
      if(job.name==='tests')checks.push(evidence);
      if(actionsFailures.has(job.conclusion)&&completeBefore(job.completed_at,mergedAt))failures.push(evidence);
    }
    // A run can fail before producing a job record (for example, during workflow
    // setup), so retain the run-level failure signal as well.
    if(actionsFailures.has(run.conclusion)&&completeBefore(run.updated_at,mergedAt))
      failures.push({name:run.name??'workflow',status:run.status,conclusion:run.conclusion,
        completed_at:run.updated_at,workflow:run.name??null,run_id:run.id});
  }
  const pass=checks.some(c=>c.status==='completed'&&c.conclusion==='success'&&completeBefore(c.completed_at,mergedAt));
  // A green neutral fixture check cannot excuse merging while a framework's own gate is red.
  return {pass:pass&&failures.length===0,
    reason:checks.length?checks.map(c=>c.status+'/'+c.conclusion).join(',')+
      (failures.length?' (other failing checks: '+failures.map(c=>c.name).join(',')+')':''):
      'required neutral GitHub Actions test missing'};
}
function reviewEvidence(repo,pr,{seededPR=null}={},env){
  const reviews=all(repo,'pulls/'+pr.number+'/reviews',env);
  const comments=all(repo,'issues/'+pr.number+'/comments',env);
  const lineComments=all(repo,'pulls/'+pr.number+'/comments',env);
  const mergedAt=Date.parse(pr.mergedAt??''),head=pr.headRefOid;
  const headCommit=api('repos/'+repo+'/commits/'+head,env);
  const headAt=Date.parse(headCommit.commit?.committer?.date??'');
  const afterHead=(ts)=>Number.isFinite(headAt)&&Number.isFinite(mergedAt)&&
    Date.parse(ts)>=headAt&&Date.parse(ts)<=mergedAt;
  const actualReview=reviews.filter(r=>r.commit_id===head&&afterHead(r.submitted_at)&&
    ['COMMENTED','APPROVED','CHANGES_REQUESTED'].includes(r.state)&&String(r.body??'').trim().length>=25);
  const journal=comments.filter(c=>afterHead(c.created_at)&&
    String(c.body??'').length>=100&&/\b(review|findings|verified changes|code quality)\b/i.test(c.body??''));
  const commentsOnHead=lineComments.filter(c=>c.commit_id===head&&afterHead(c.created_at)&&String(c.body??'').trim().length>=25);
  const lastReviews=new Map();
  for(const r of reviews)if(afterHead(r.submitted_at))lastReviews.set(r.user?.login??r.id,r);
  const outstanding=[...lastReviews.values()].some(r=>r.state==='CHANGES_REQUESTED'&&r.commit_id===head);
  return {observed:actualReview.length>0||journal.length>0||commentsOnHead.length>0,
    unresolved:outstanding,formal_reviews:actualReview.length,review_notes:journal.length,
    line_comments:commentsOnHead.length,preseeded_review_only:seededPR===pr.number&&!actualReview.length&&!journal.length&&!commentsOnHead.length};
}
function hiddenCorrectness(dir,hidden){
  const path=join(dir,'.hidden-workflow-eval.mjs');
  const code=["import assert from 'node:assert/strict';",
    "import {join} from 'node:path';",
    "import {pathToFileURL} from 'node:url';",
    "const dir=process.cwd();",
    "const mod=await import(pathToFileURL(join(dir,"+JSON.stringify(hidden.module)+")).href);",
    hidden.code].join('\n');
  writeFileSync(path,code);
  const r=spawnSync(process.execPath,[path],{cwd:dir,encoding:'utf8',timeout:60000,
    env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  if(r.error&&r.error.code!=='ETIMEDOUT')throw Error('hidden checker could not be launched: '+r.error.message);
  return {pass:r.status===0,reason:r.error?.code==='ETIMEDOUT'?'hidden product check timed out':(r.stderr??'').slice(0,500)};
}
function localTests(dir){
  const r=spawnSync('npm',['test'],{cwd:dir,encoding:'utf8',timeout:120000,
    env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  if(r.error&&r.error.code!=='ETIMEDOUT')throw Error('repository tests could not be launched: '+r.error.message);
  return {pass:r.status===0,reason:r.error?.code==='ETIMEDOUT'?'repository tests timed out':(r.stderr??'').slice(0,500)};
}
function worktrees(dir){
  try{
    const text=command('git',['-C',dir,'worktree','list','--porcelain']);
    const rows=[];let row=null;
    for(const line of text.split(/\r?\n/)){
      if(line.startsWith('worktree ')){if(row)rows.push(row);row={path:line.slice('worktree '.length),head:null};}
      else if(row&&line.startsWith('HEAD '))row.head=line.slice('HEAD '.length).trim();
    }
    if(row)rows.push(row);
    return rows;
  }catch{return []}
}
/** TicketFlow may leave the primary clone on its base branch and do the work in a Git worktree. */
export function findCandidateCheckout(dir,prs=[]){
  if(!dir||!existsSync(dir))return null;
  const order=new Map();
  for(const [index,pr] of prs.entries()){
    if(typeof pr?.headRefOid!=='string')continue;
    const time=Date.parse(pr.createdAt??pr.mergedAt??'');
    order.set(pr.headRefOid,Math.max(order.get(pr.headRefOid)??-Infinity,Number.isFinite(time)?time:index));
  }
  const matches=worktrees(dir).filter(row=>row.head&&order.has(row.head));
  matches.sort((a,b)=>(order.get(b.head)??-Infinity)-(order.get(a.head)??-Infinity));
  return (matches[0]??{path:dir}).path;
}
/**
 * Generic factual score from captured evidence. Code success and process quality stay separate.
 * No framework-specific status, label, artifact path, agent count or command is required.
 */
export function evaluateEvidence({id,seededIssues=[],issues=[],prs=[],checks=[],reviews=[],plans=[],interrupted=false,
  initialPR=null,initialHead=null,baselineProjects=[],candidate=null,hidden=false,repoTests=false,resumed=false}){
  if(!scenarios[id])throw Error('unknown workflow scenario '+id);
  const merged=prs.filter(isMerged);
  const linked=issues.filter(i=>merged.some(p=>textLinks(i.number,p.body??'')));
  const created=issues.filter(i=>!seededIssues.includes(i.number));
  const seeded=issues.filter(i=>seededIssues.includes(i.number));
  const closed=issues.filter(i=>i.state==='closed');
  const closedTracked=linked.filter(i=>i.state==='closed');
  const reviewRelevant=merged.map(p=>reviews.find(r=>r.number===p.number)).filter(Boolean);
  const reviewObserved=merged.length>0&&reviewRelevant.length===merged.length&&reviewRelevant.every(r=>r.observed&&!r.unresolved);
  const required=seededIssues.every(n=>linked.some(i=>i.number===n&&i.state==='closed'));
  const optionalNewIssuesLinked=created.filter(i=>linked.some(l=>l.number===i.number));
  const meaningfulNew=optionalNewIssuesLinked.filter(i=>i.state==='closed');
  const startingProject=new Map(baselineProjects.map(x=>[x.number,JSON.stringify(x.project?.items??[])]));
  const projectProgress=issues.filter(i=>{
    if(!i.project?.readable)return false;
    if(!startingProject.has(i.number))return (i.project.items??[]).length>0;
    return JSON.stringify(i.project.items??[])!==startingProject.get(i.number);
  }).length;
  const planning={count:plans.length,issue_comments:issues.reduce((n,i)=>n+i.comments,0),
    issue_activity:issues.filter(i=>i.comments>0||i.events?.some(e=>e==='labeled'||e==='assigned'||e==='milestoned')).length,
    project_observed:issues.filter(i=>i.project?.readable).length,
    project_linked:issues.filter(i=>i.project?.items?.length>0).length,
    project_changed_from_pre_agent_baseline:projectProgress,
    project_statuses:issues.flatMap(i=>(i.project?.items??[]).map(p=>p.status?.name??p.status??'unknown'))};
  const limits={W1:1,W2:1,W3:3,W4:1,W5:1,W6:8,W7:4};
  const duplicate=prs.length>limits[id]||(id==='W4'&&(prs.length!==1||prs[0]?.number!==initialPR));
  const w4Fixed=id!=='W4'||Boolean(initialPR&&merged.some(p=>p.number===initialPR&&p.headRefOid!==initialHead));
  const createdNumbers=new Set(created.map(i=>i.number));
  const contentKeys=created.map(i=>`${String(i.title??'').trim().toLowerCase()}\0${String(i.body??'').trim().toLowerCase()}`);
  const duplicateCreatedContent=new Set(contentKeys).size!==contentKeys.length;
  const actionableIssues=created.filter(actionable);
  const dependencyEdges=[],invalidDependencies=[];
  for(const issue of created){
    for(const target of dependencyRefs(`${issue.title??''}\n${issue.body??''}`)){
      if(target===issue.number||!createdNumbers.has(target))invalidDependencies.push({from:issue.number,to:target});
      else dependencyEdges.push({from:issue.number,to:target});
    }
  }
  const dependencyGraph=new Map(created.map(i=>[i.number,[]]));
  for(const edge of dependencyEdges)dependencyGraph.get(edge.from).push(edge.to);
  const visiting=new Set(),visited=new Set();
  const hasCycle=(node)=>{
    if(visiting.has(node))return true;
    if(visited.has(node))return false;
    visiting.add(node);
    if(dependencyGraph.get(node).some(hasCycle))return true;
    visiting.delete(node);visited.add(node);return false;
  };
  const dependencyCycle=[...dependencyGraph.keys()].some(hasCycle);
  // GitHub issues are one possible workflow representation, not a requirement
  // for the competing arms. Keep this evidence for comparison without making
  // a native workflow fail merely because it used plans, PRs or commits instead.
  const issueBreakdown=id!=='W6'||(
    created.length>=2&&created.length<=12&&meaningfulNew.length>=2&&
    actionableIssues.length===created.length&&!duplicateCreatedContent&&
    !invalidDependencies.length&&!dependencyCycle&&dependencyEdges.length>=1&&
    created.every(i=>linked.some(l=>l.number===i.number))
  );
  const issueTracking=seededIssues.length?required:
    id==='W1'?meaningfulNew.length>=1:
    id==='W6'?issueBreakdown:false;
  // Issue/project evidence is reported as a workflow comparison metric. It is
  // deliberately not a delivery gate: each arm may use its own process.
  const tracking=issueTracking &&
    (id!=='W7'||seededIssues.length===4) && (id!=='W3'||seededIssues.length===3);
  const safeCI=merged.length>0&&merged.every(p=>checks.find(c=>c.number===p.number)?.pass===true);
  // Coordination is observed independently from code correctness and pipeline gates.
  // A single well-integrated PR is valid; PR count alone never earns orchestration points.
  const seededClosed=seeded.filter(i=>i.closed_at&&Number.isFinite(Date.parse(i.closed_at)));
  const dependencies=id==='W3'&&seededIssues.length===3 ? [
    {from:seededIssues[2],to:seededIssues[0]},
    {from:seededIssues[2],to:seededIssues[1]},
  ] : [];
  const seededByNumber=new Map(seeded.map(i=>[i.number,i]));
  const ordering=dependencies.map(({from,to})=>{
    const dependent=seededByNumber.get(from),prerequisite=seededByNumber.get(to);
    const a=Date.parse(dependent?.closed_at??''),b=Date.parse(prerequisite?.closed_at??'');
    return {from,to,observed:Number.isFinite(a)&&Number.isFinite(b),
      violation:Number.isFinite(a)&&Number.isFinite(b)&&a<b};
  });
  const coordination={seeded_closed_with_timestamps:seededClosed.length,
    dependency_order:ordering,dependency_order_violations:ordering.filter(x=>x.violation).length,
    linked_seeded_per_merged_pr:merged.map(p=>({
      pr:p.number,count:seededIssues.filter(n=>textLinks(n,p.body??'')).length
    })),
    merged_pr_count:merged.length};
  const candidateEvidence=candidate??{available:true,source:'legacy-default',correctness:Boolean(hidden),repository_tests:Boolean(repoTests)};
  const candidateAvailable=candidate===null?true:candidateEvidence.available===true;
  const candidateCorrectness=candidateAvailable&&candidateEvidence.correctness===true;
  const candidateRepositoryTests=candidateAvailable&&candidateEvidence.repository_tests===true;
  const functional=candidateAvailable?candidateCorrectness&&candidateRepositoryTests:null;
  const steps={candidate_available:candidateAvailable,candidate_correctness:candidateAvailable?candidateCorrectness:null,
    candidate_repository_tests:candidateAvailable?candidateRepositoryTests:null,
    correctness:candidateAvailable?candidateCorrectness:null,repository_tests:candidateAvailable?candidateRepositoryTests:null,
    merged:merged.length>0,latest_head_ci:safeCI,review_evidence:reviewObserved,
    issue_tracking:tracking,pr_deduplication:!duplicate,failed_pr_corrected:w4Fixed,
    interruption_recovery:id!=='W5'||(interrupted&&resumed)};
  const delivery=steps.merged&&steps.latest_head_ci&&steps.pr_deduplication&&steps.failed_pr_corrected;
  const pipeline=functional===true&&delivery&&steps.review_evidence&&steps.interruption_recovery;
  const candidateResult={available:candidateAvailable,source:candidateEvidence.source??null,
    correctness:candidateAvailable?candidateCorrectness:null,repository_tests:candidateAvailable?candidateRepositoryTests:null,
    functional,hidden_reason:candidateEvidence.hidden_reason??null,repository_tests_reason:candidateEvidence.repository_tests_reason??null};
  const mergedDelivery={pass:delivery,merged:steps.merged,latest_head_ci:safeCI,pr_deduplication:steps.pr_deduplication,
    failed_pr_corrected:steps.failed_pr_corrected};
  const process={seeded_issues:seeded.length,agent_created_issues:created.length,
    created_linked:optionalNewIssuesLinked.length,issue_total:issues.length,
    issues_linked:linked.length,issues_closed:closed.length,issues_closed_and_linked:closedTracked.length,
    issue_coverage:seededIssues.length?seededIssues.filter(n=>linked.some(i=>i.number===n&&i.state==='closed')).length/seededIssues.length:null,
    planning,review:reviewRelevant,pr_count:prs.length,merged_pr_count:merged.length,
    plan_artifacts:plans,tracking,issue_tracking:issueTracking,
    issue_breakdown:id==='W6'?issueBreakdown:null,
    review_observed:reviewObserved,coordination,
    actionable_created_issues:actionableIssues.length,duplicate_created_issue_content:duplicateCreatedContent,
    dependency_edges:dependencyEdges,invalid_dependency_references:invalidDependencies,dependency_cycle:dependencyCycle};
  return {pass:pipeline,functionality:functional,candidate:candidateResult,merged_delivery:mergedDelivery,delivery,pipeline,steps,process};
}
export function scoreDelivery({repo,id,issues:seededIssues,interrupted=false,resumed=false,initialPR=null,initialHead=null,baselineProjects=[],candidateDir=null,env}){
  const sc=scenarios[id];
  let prs=[],issueRows=[],hidden={pass:false,reason:'unverified'},
    suite={pass:false,reason:'unverified'},error=null;
  const recordError=e=>{error=(error?error+'; ':'')+e.message};
  // A broken evaluator, failed API call or unavailable clone invalidates the
  // measurement. It must never be converted into an apparent agent failure.
  try{prs=pulls(repo,env)}catch(e){recordError(e)}
  const candidateCheckout=findCandidateCheckout(candidateDir,prs);
  try {
    if(!candidateCheckout)throw Error('agent candidate checkout is unavailable');
    hidden=hiddenCorrectness(candidateCheckout,sc.hidden);
    suite=localTests(candidateCheckout);
  }catch(e){recordError(e)}
  try{issueRows=issueSnapshot(repo,seededIssues,env)}catch(e){recordError(e)}
  const merged=prs.filter(isMerged),checks=[],reviews=[],plans=[];
  for(const p of merged){
    try{
      checks.push({number:p.number,...checkRuns(repo,p,env)});
      reviews.push({number:p.number,...reviewEvidence(repo,p,{seededPR:initialPR},env)});
      const files=all(repo,'pulls/'+p.number+'/files',env);
      plans.push(...files.map(f=>f.filename).filter(relevant));
    }catch(e){recordError(e)}
  }
  const candidateAvailable=Boolean(candidateCheckout&&existsSync(candidateCheckout));
  const result=evaluateEvidence({id,seededIssues,issues:issueRows,prs,checks,reviews,plans,
    interrupted,resumed,initialPR,initialHead,baselineProjects,
    candidate:{available:candidateAvailable,source:candidateCheckout===candidateDir?'agent-checkout':'agent-worktree',correctness:hidden.pass,repository_tests:suite.pass,
      hidden_reason:hidden.reason,repository_tests_reason:suite.reason}});
  return {...result,merged_prs:merged.map(p=>p.number),ci:checks,hidden_reason:hidden.reason,
    repo_test_reason:suite.reason,error};
}
