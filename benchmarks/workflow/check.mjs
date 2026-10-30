/**
 * Independent workflow evaluator. The agent never receives these hidden checks.
 * Treat review/plan evidence as observable proxies, never a guarantee of review quality.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const api=(path)=>JSON.parse(command('gh',['api',path]));
const ghjson=(args)=>JSON.parse(command('gh',args));
const all=(repo,endpoint)=>{ // All pages or fail, rather than silently scoring partial evidence.
  const separator=endpoint.includes('?')?'&':'?';
  const data=ghjson(['api','--paginate','--slurp','repos/'+repo+'/'+endpoint+separator+'per_page=100']);
  if(!Array.isArray(data)||!data.every(Array.isArray))throw Error('GitHub pagination response invalid for '+endpoint);
  return data.flat();
};
export const pulls=(repo)=>ghjson(['pr','list','-R',repo,'--state','all',
  '--json','number,headRefOid,mergedAt,body,headRefName,createdAt','--limit','100']);
export const checkpoint=(repo)=>pulls(repo).some(p=>!p.mergedAt);
const textLinks=(n,body)=>new RegExp('(?:#|issues/)'+n+'(?!\\d)').test(body);
const isMerged=(p)=>Boolean(p.mergedAt);
const relevant=(name)=>/(?:^|\/)(?:plans?|design|decisions|docs\/architecture)\/.*\.md$/i.test(name);
export const projectSnapshot=(repo,n)=>{
  try {
    const data=ghjson(['issue','view',String(n),'-R',repo,'--json','projectItems']);
    return {readable:true,items:data.projectItems??[]};
  } catch {return {readable:false,items:[]};}
};
const issueSnapshot=(repo,seed)=>{
  const issues=all(repo,'issues?state=all').filter(i=>!i.pull_request);
  const records=issues.map(issue=>{
    const comments=all(repo,'issues/'+issue.number+'/comments');
    const timeline=all(repo,'issues/'+issue.number+'/events');
    const project=projectSnapshot(repo,issue.number);
    return {number:issue.number,title:issue.title,state:issue.state,created_at:issue.created_at,
      seeded:seed.includes(issue.number),comments:comments.length,
      comments_after_creation:comments.filter(c=>c.created_at>issue.created_at).length,
      milestone:issue.milestone?.title??null,labels:(issue.labels??[]).map(x=>x.name),
      closed_at:issue.closed_at??null,
      events:timeline.map(e=>e.event),project};
  });
  return records;
};
function checkRuns(repo,pr){
  if(!pr?.headRefOid||!pr?.mergedAt)return {pass:false,reason:'no merged PR and final head'};
  const runs=api('repos/'+repo+'/commits/'+pr.headRefOid+'/check-runs?per_page=100').check_runs??[];
  const checks=runs.filter(c=>c.name==='tests'&&c.app?.slug==='github-actions');
  const pass=checks.some(c=>c.status==='completed'&&c.conclusion==='success'&&
    c.completed_at&&Date.parse(c.completed_at)<=Date.parse(pr.mergedAt));
  return {pass,reason:checks.length?checks.map(c=>c.status+'/'+c.conclusion).join(','):'required neutral GitHub Actions test missing'};
}
function reviewEvidence(repo,pr,{seededPR=null}={}){
  const reviews=all(repo,'pulls/'+pr.number+'/reviews');
  const comments=all(repo,'issues/'+pr.number+'/comments');
  const lineComments=all(repo,'pulls/'+pr.number+'/comments');
  const mergedAt=Date.parse(pr.mergedAt??''),head=pr.headRefOid;
  const headCommit=api('repos/'+repo+'/commits/'+head);
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
  return {pass:r.status===0,reason:(r.stderr??'').slice(0,500)};
}
function localTests(dir){
  const r=spawnSync('npm',['test'],{cwd:dir,encoding:'utf8',timeout:120000,
    env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  return {pass:r.status===0,reason:(r.stderr??'').slice(0,500)};
}
/**
 * Generic factual score from captured evidence. Code success and process quality stay separate.
 * No framework-specific status, label, artifact path, agent count or command is required.
 */
export function evaluateEvidence({id,seededIssues=[],issues=[],prs=[],checks=[],reviews=[],plans=[],interrupted=false,
  initialPR=null,initialHead=null,baselineProjects=[],hidden=false,repoTests=false}){
  if(!scenarios[id])throw Error('unknown workflow scenario '+id);
  const merged=prs.filter(isMerged),mergedBodies=merged.map(p=>p.body??'').join('\n');
  const linked=issues.filter(i=>merged.some(p=>textLinks(i.number,p.body??'')));
  const created=issues.filter(i=>!seededIssues.includes(i.number));
  const seeded=issues.filter(i=>seededIssues.includes(i.number));
  const closed=issues.filter(i=>i.state==='closed');
  const closedTracked=linked.filter(i=>i.state==='closed');
  const reviewRelevant=merged.map(p=>reviews.find(r=>r.number===p.number)).filter(Boolean);
  const reviewObserved=reviewRelevant.length===merged.length&&reviewRelevant.every(r=>r.observed&&!r.unresolved);
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
  const newTracking=(id==='W1'?meaningfulNew.length>=1:
    id==='W6'?meaningfulNew.length>=2&&created.length<=12:true);
  // W6 should have at least two thoughtfully created tasks; W1 one tracked request.
  // Others may use their own process, but transparent linkage is measured everywhere.
  const tracking=required&&newTracking&&(id!=='W6'||created.every(i=>linked.some(l=>l.number===i.number))) &&
    (id!=='W7'||seededIssues.length===4) && (id!=='W3'||seededIssues.length===3);
  const safeCI=merged.length>0&&merged.every(p=>checks.find(c=>c.number===p.number)?.pass===true);
  const steps={correctness:!!hidden,repository_tests:!!repoTests,
    merged:merged.length>0,latest_head_ci:safeCI,review_evidence:reviewObserved,
    issue_tracking:tracking,pr_deduplication:!duplicate,failed_pr_corrected:w4Fixed,
    interruption_recovery:id!=='W5'||interrupted};
  const functional=steps.correctness&&steps.repository_tests;
  const delivery=steps.merged&&steps.latest_head_ci&&steps.pr_deduplication&&steps.failed_pr_corrected;
  const pipeline=functional&&delivery&&steps.review_evidence&&steps.issue_tracking&&steps.interruption_recovery;
  const process={seeded_issues:seeded.length,agent_created_issues:created.length,
    created_linked:optionalNewIssuesLinked.length,issue_total:issues.length,
    issues_linked:linked.length,issues_closed:closed.length,issues_closed_and_linked:closedTracked.length,
    issue_coverage:seededIssues.length?seededIssues.filter(n=>linked.some(i=>i.number===n&&i.state==='closed')).length/seededIssues.length:null,
    planning,review:reviewRelevant,pr_count:prs.length,merged_pr_count:merged.length,
    plan_artifacts:plans,tracking,review_observed:reviewObserved};
  return {pass:pipeline,functionality:functional,delivery,pipeline,steps,process};
}
export function scoreDelivery({repo,id,issues:seededIssues,interrupted=false,initialPR=null,initialHead=null,baselineProjects=[]}){
  const sc=scenarios[id],prs=pulls(repo),work=mkdtempSync(join(tmpdir(),'workflow-verify-'));
  let hidden={pass:false,reason:'unverified'},suite={pass:false,reason:'unverified'},error=null;
  try {
    command('gh',['repo','clone',repo,join(work,'checkout'),'--','--depth','1'],{timeout:120000});
    hidden=hiddenCorrectness(join(work,'checkout'),sc.hidden);
    suite=localTests(join(work,'checkout'));
  }catch(e){error=e.message;}
  finally{rmSync(work,{recursive:true,force:true});}
  const issueRows=issueSnapshot(repo,seededIssues);
  const merged=prs.filter(isMerged),checks=[],reviews=[],plans=[];
  for(const p of merged){
    try{
      checks.push({number:p.number,...checkRuns(repo,p)});
      reviews.push({number:p.number,...reviewEvidence(repo,p,{seededPR:initialPR})});
      const files=all(repo,'pulls/'+p.number+'/files');
      plans.push(...files.map(f=>f.filename).filter(relevant));
    }catch(e){error=(error?error+'; ':'')+e.message}
  }
  const result=evaluateEvidence({id,seededIssues,issues:issueRows,prs,checks,reviews,plans,
    interrupted,initialPR,initialHead,baselineProjects,hidden:hidden.pass,repoTests:suite.pass});
  return {...result,merged_prs:merged.map(p=>p.number),ci:checks,hidden_reason:hidden.reason,
    repo_test_reason:suite.reason,error};
}
