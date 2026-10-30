/** Independently score observable GitHub delivery and hidden product behavior. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenarios } from './scenarios.mjs';

export const command = (bin,args,options={}) => {
  const out=spawnSync(bin,args,{encoding:'utf8',timeout:options.timeout ?? 120000,maxBuffer:16*1024*1024,cwd:options.cwd,env:options.env ?? process.env});
  if(out.error || out.status!==0) throw Error(bin+' '+args.slice(0,4).join(' ')+' failed: '+String(out.stderr || out.error?.message || out.status).slice(0,500));
  return out.stdout.trim();
};
const json = (bin,args,options) => JSON.parse(command(bin,args,options));
const gh = (args) => json('gh',args);
const api = (endpoint) => gh(['api',endpoint]);
export function pulls(repo) {
  return gh(['pr','list','-R',repo,'--state','all','--json','number,headRefOid,mergedAt,body,headRefName','--limit','100']);
}
export function mergedPulls(repo) {return pulls(repo).filter(p=>p.mergedAt);}
export function checkpoint(repo) {return pulls(repo).some(p=>!p.mergedAt);}
function testsPassed(dir,hidden) {
  const file=join(dir,'.workflow-hidden-check.mjs');
  const code=[
    "import assert from 'node:assert/strict';",
    "import {join} from 'node:path';",
    "import {pathToFileURL} from 'node:url';",
    "const dir=process.cwd();",
    "const mod=await import(pathToFileURL(join(dir,"+JSON.stringify(hidden.module)+")).href);",
    hidden.code
  ].join('\n');
  writeFileSync(file,code);
  const result=spawnSync(process.execPath,[file],{cwd:dir,encoding:'utf8',timeout:60000,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  return {pass:result.status===0,why:(result.stderr||'').trim().slice(0,450)};
}
function checkRun(repo,sha) {
  if(!sha) return {pass:false,reason:'no PR head'};
  const checks=api('repos/'+repo+'/commits/'+sha+'/check-runs?per_page=100').check_runs ?? [];
  // The shared fixture supplies the same neutral "bench / tests" workflow to all arms.
  const x=checks.filter(c=>c.name==='tests' && c.app?.slug==='github-actions');
  return {pass:x.some(c=>c.status==='completed' && c.conclusion==='success'),
    reason:x.length ? x.map(c=>c.conclusion ?? c.status).join(',') : 'missing GitHub Actions tests check'};
}
function hasReview(repo,number,body) {
  const reviews=api('repos/'+repo+'/pulls/'+number+'/reviews?per_page=100');
  const comments=api('repos/'+repo+'/issues/'+number+'/comments?per_page=100');
  const reviewText=[body??'',...reviews.map(x=>x.body??''),...comments.map(x=>x.body??'')].join('\n');
  return reviews.some(x=>x.state==='APPROVED'||x.state==='COMMENTED'||x.state==='CHANGES_REQUESTED') ||
    /\b(review notes|code review|review findings|reviewed the|review:|no blockers)\b/i.test(reviewText);
}
function linked(issueNumbers,prs) {
  const text=prs.map(p=>p.body??'').join('\n');
  return issueNumbers.every(n=>new RegExp('(?:#|issues/)' + n + '(?!\\d)').test(text));
}
export function scoreDelivery({repo,id,issues,interrupted=false}) {
  const sc=scenarios[id], prs=pulls(repo), done=prs.filter(p=>p.mergedAt);
  const work=mkdtempSync(join(tmpdir(),'workflow-verify-'));
  let hidden={pass:false,why:'not checked'}, suite=false, ci={pass:false,reason:'no merged PR'}, review=false,err=null;
  try {
    command('gh',['repo','clone',repo,join(work,'checkout'),'--','--depth','1'],{timeout:120000});
    const dir=join(work,'checkout');
    hidden=testsPassed(dir,sc.hidden);
    suite=spawnSync('npm',['test'],{cwd:dir,encoding:'utf8',timeout:120000,
      env:{PATH:process.env.PATH,HOME:process.env.HOME}}).status===0;
    // node --test does not accept --runInBand; use plain npm test below if needed.
  } catch(e) {err=e.message;}
  finally {rmSync(work,{force:true,recursive:true});}
  if(done.length) {
    const x=done.at(-1);
    try {ci=checkRun(repo,x.headRefOid);review=hasReview(repo,x.number,x.body);}
    catch(e){err=(err?err+'; ':'')+e.message;}
  }
  const limit=id==='W3'?3:1;
  const duplicate=prs.length>limit || (id==='W4' && prs.length!==1);
  const tracking=linked(issues,done);
  const steps={correctness:hidden.pass,repo_tests:suite,ci_green:ci.pass,merged:done.length>0,review_evidence:review,
    issue_linkage:tracking,no_duplicate_pr:!duplicate,recovery:id==='W5'?interrupted:true};
  return {pass:Object.values(steps).every(Boolean),steps,merged_prs:done.map(p=>p.number),
    count_prs:prs.length,hidden_why:hidden.why,ci_reason:ci.reason,error:err};
}
