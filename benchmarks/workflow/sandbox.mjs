/** Real GitHub fixture setup. Paid runs are opt-in, repos are disposable. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fixture, scenarios } from './scenarios.mjs';

export function setupEnv() {
  if(!process.env.WORKFLOW_BENCH_SETUP_TOKEN) throw Error('WORKFLOW_BENCH_SETUP_TOKEN required; use only a dedicated disposable organization');
  return {...process.env,GH_TOKEN:process.env.WORKFLOW_BENCH_SETUP_TOKEN,
    GITHUB_TOKEN:process.env.WORKFLOW_BENCH_SETUP_TOKEN,GIT_TERMINAL_PROMPT:'0'};
}
export function sh(bin,args,{cwd,env=setupEnv(),timeout=120000}={}) {
  const result=spawnSync(bin,args,{encoding:'utf8',cwd,env,timeout,maxBuffer:16*1024*1024});
  if(result.error||result.status!==0) throw Error(bin+' '+args.slice(0,6).join(' ')+' failed: '+String(result.stderr||result.error?.message||result.status).slice(0,700));
  return result.stdout.trim();
}
export const gh=(args,opts)=>sh('gh',args,opts);
const git=(cwd,args,env)=>sh('git',args,{cwd,env});
const write=(dir,p,content)=>{
  const target=join(dir,p);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);
};
export const legalSlug=(s)=>/^[a-z][a-z0-9-]{2,50}$/.test(s);
export function validateOrg(org) {
  if(!legalSlug(org)) throw Error('--owner must be a lowercase dedicated GitHub organization slug');
  const response=JSON.parse(gh(['api','orgs/'+org]));
  if(response.login.toLowerCase()!==org) throw Error('organization '+org+' not found');
  return org;
}
export const cfg=(repo,owner,number,agent='claude',title='Workflow benchmark')=>({
  schema_version:2,repo,default_branch:'main',verify:{mode:'ci',command:'npm test'},
  project:{owner,number,title},agents:[agent],
  models:{[agent]:{strong:null,standard:null,light:null}}
});
const gitPush=(dir,env,ref)=>{
  git(dir,['-c','credential.helper=!gh auth git-credential','push','origin',ref],env);
};
export function newRepository({repo,id,work}) {
  const env=setupEnv(),dir=join(work,'seed');
  mkdirSync(dir,{recursive:true});
  for(const [path,content] of Object.entries(fixture(id))) write(dir,path,content);
  git(dir,['init','-q','-b','main'],env);
  git(dir,['-c','user.name=workflow-bench','-c','user.email=workflow-bench@example.invalid','add','-A'],env);
  git(dir,['-c','user.name=workflow-bench','-c','user.email=workflow-bench@example.invalid','commit','-qm','seed fixture'],env);
  gh(['repo','create',repo,'--private','--disable-wiki'],{env});
  git(dir,['remote','add','origin','https://github.com/'+repo+'.git'],env);
  gitPush(dir,env,'HEAD:main');
  return dir;
}
/**
 * Neutral GitHub Projects v2 setup, not TicketFlow's workflow.
 * Every cell gets its own initially empty board, identically for all arms.
 * TicketFlow may configure that board using its OWN setup when its arm installs.
 */
const graphql=(query,variables={})=>{
  const args=['api','graphql','-f','query='+query];
  for(const [key,value] of Object.entries(variables)) args.push('-f',key+'='+String(value));
  const result=JSON.parse(gh(args));
  if(result.errors?.length)throw Error('GitHub GraphQL: '+JSON.stringify(result.errors).slice(0,600));
  return result.data;
};
export function linkProject({repo,owner,title}) {
  const data=graphql('query($org:String!,$repo:String!){ organization(login:$org){id projectsV2(first:100){nodes{id number title} pageInfo{hasNextPage}}} repository(owner:$org,name:$repo){id}}',
    {org:owner,repo:repo.split('/')[1]});
  if(!data.organization||!data.repository)throw Error('Project owner or repository not accessible');
  const projects=data.organization.projectsV2;
  const matches=projects.nodes.filter(p=>p.title===title);
  if(matches.length>1 || (projects.pageInfo.hasNextPage && matches.length===0))
    throw Error('Project lookup is ambiguous; dedicated organization has too many projects');
  if(matches.length) return {number:matches[0].number,id:matches[0].id};
  const created=graphql('mutation($o:ID!,$r:ID!,$t:String!){createProjectV2(input:{ownerId:$o,repositoryId:$r,title:$t}){projectV2{id number}}}',
    {o:data.organization.id,r:data.repository.id,t:title}).createProjectV2.projectV2;
  if(!created?.id||!created?.number)throw Error('GitHub Project not created');
  return created;
}
export function seedIssues({repo,id,projectId}) {
  const issues=[];
  for(const [index,body] of scenarios[id].issues.entries()) {
    const url=gh(['issue','create','-R',repo,'--title',id+' benchmark: '+(index+1),'--body',body]);
    const n=Number(url.match(/\/issues\/(\d+)$/)?.[1]);
    if(!n)throw Error('unexpected issue URL '+url);
    issues.push(n);
    const issue=JSON.parse(gh(['api','repos/'+repo+'/issues/'+n]));
    graphql('mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}',
      {p:projectId,c:issue.node_id});
  }
  if(id==='W3' && issues.length===3) {
    const body=scenarios.W3.issues[2]+'\n\nDepends on #'+issues[0]+', #'+issues[1]+'.';
    gh(['issue','edit',String(issues[2]),'-R',repo,'--body',body]);
  }
  return issues;
}
export function seedBrokenPull({repo,id,work,issue}) {
  const sc=scenarios[id];
  if(!sc.seedBrokenPR) return null;
  const dir=join(work,'seed'),env=setupEnv();
  git(dir,['fetch','origin','main'],env);
  git(dir,['checkout','main'],env);
  git(dir,['reset','--hard','origin/main'],env);
  git(dir,['checkout','-qb',sc.seedBrokenPR.branch],env);
  for(const [path,source] of Object.entries(sc.seedBrokenPR.changes)) write(dir,path,source);
  git(dir,['add','-A'],env);
  git(dir,['-c','user.name=workflow-bench','-c','user.email=workflow-bench@example.invalid','commit','-qm','introduce regression for review'],env);
  gitPush(dir,env,'HEAD:'+sc.seedBrokenPR.branch);
  const url=gh(['pr','create','-R',repo,'--head',sc.seedBrokenPR.branch,'--base','main',
    '--title','Repair incoming webhook PR','--body','Refs #'+issue+' (benchmark fixture)']);
  const number=Number(url.match(/\/pull\/(\d+)$/)?.[1]);
  if(!number) throw Error('unexpected PR URL '+url);
  gh(['pr','review',String(number),'-R',repo,'--comment','--body',sc.seedBrokenPR.review],{env});
  return number;
}
export function cloneRepository(repo,root,agent='claude') {
  const dir=join(root,'repo');mkdirSync(root,{recursive:true});
  gh(['repo','clone',repo,dir,'--','--depth','1']);
  const env=setupEnv();
  git(dir,['config','credential.helper','!gh auth git-credential'],env);
  git(dir,['config','user.name','workflow-benchmark-agent'],env);
  git(dir,['config','user.email','workflow-benchmark@example.invalid'],env);
  return dir;
}
export function installTicketFlow({repo,dir,source,agent,owner,projectNumber,title,issues=[]}) {
  write(dir,'.ticketflow/config.json',JSON.stringify(cfg(repo,owner,projectNumber,agent,title)));
  sh('node',[join(source,'core/scripts/runtime.mjs'),source,dir],{cwd:dir});
  sh('node',[join(dir,'.ticketflow/scripts/gen-stubs.mjs'),join(dir,'.ticketflow'),dir],{cwd:dir});
  sh('node',[join(dir,'.ticketflow/scripts/render.mjs'),join(dir,'.ticketflow/templates'),dir],{cwd:dir});
  const env=setupEnv();
  git(dir,['add','-A'],env);
  git(dir,['-c','user.name=workflow-bench','-c','user.email=workflow-bench@example.invalid','commit','-qm','install TicketFlow benchmark runtime'],env);
  gitPush(dir,env,'HEAD:main');
  // Only the TicketFlow arm configures its Project lifecycle and Ready queue.
  sh(process.execPath,[join(dir,'.ticketflow/scripts/project.mjs'),'setup'],{cwd:dir});
  for(const issue of issues) sh(process.execPath,[join(dir,'.ticketflow/scripts/project.mjs'),'status',String(issue),'Ready'],{cwd:dir});
}
export function cleanupLocal(work) {rmSync(work,{recursive:true,force:true});}
export function newWork(){return mkdtempSync(join(tmpdir(),'tf-workflow-'));}
