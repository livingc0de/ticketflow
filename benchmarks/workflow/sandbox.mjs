/** Real GitHub fixture setup. Paid runs are opt-in, repos are disposable. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fixture, scenarios, fillIssue } from './scenarios.mjs';

export function setupEnv({token=process.env.WORKFLOW_BENCH_SETUP_TOKEN,base=process.env}={}) {
  if(!token) throw Error('workflow setup authentication required');
  return {...base,GH_TOKEN:token,GITHUB_TOKEN:token,GIT_TERMINAL_PROMPT:'0'};
}
export function sh(bin,args,{cwd,env=setupEnv(),timeout=120000}={}) {
  const result=spawnSync(bin,args,{encoding:'utf8',cwd,env,timeout,maxBuffer:16*1024*1024});
  if(result.error||result.status!==0) throw Error(bin+' '+args.slice(0,6).join(' ')+' failed: '+String(result.stderr||result.error?.message||result.status).slice(0,700));
  return result.stdout.trim();
}
export const gh=(args,opts)=>sh('gh',args,opts);
const loginEnv=()=>({...process.env,GIT_TERMINAL_PROMPT:'0'});
export function authenticatedUser({env=loginEnv()}={}) {
  const user=JSON.parse(sh('gh',['api','user'],{env}));
  if(!user.login||user.type!=='User')throw Error('gh login must identify a personal GitHub user');
  return user.login.toLowerCase();
}
export function authenticatedToken({env=loginEnv()}={}) {
  const token=sh('gh',['auth','token'],{env}).trim();
  if(!token)throw Error('gh login did not provide an access token');
  return token;
}
const git=(cwd,args,env)=>sh('git',args,{cwd,env});
const SEED_AUTHOR=['-c','user.name=Maintainer','-c','user.email=maintainer@example.invalid'];
const write=(dir,p,content)=>{
  const target=join(dir,p);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);
};
export const legalSlug=(s)=>/^[a-z][a-z0-9-]{2,50}$/.test(s);
export function validateOrg(org,{env=setupEnv()}={}) {
  if(!legalSlug(org)) throw Error('--org must be a lowercase dedicated GitHub organization slug');
  const response=JSON.parse(gh(['api','orgs/'+org],{env}));
  if(response.login.toLowerCase()!==org) throw Error('organization '+org+' not found');
  return org;
}
// The model classes a default install maps (core/templates/config.json), so a benchmark run dispatches planner and reviewer on the same models a real repo does.
export const MODELS={
  claude:{strong:'opus',standard:'sonnet',light:'haiku'},
  codex:{strong:'astra',standard:'sol',light:'luna'}
};
export const cfg=(repo,owner,number,agent='claude',title='Workflow benchmark')=>({
  schema_version:2,repo,default_branch:'main',verify:{mode:'ci',command:'npm test'},
  project:{owner,number,title},agents:[agent],
  models:{[agent]:MODELS[agent]??{strong:null,standard:null,light:null}}
});
const gitPush=(dir,env,ref)=>{
  git(dir,['-c','credential.helper=!gh auth git-credential','push','origin',ref],env);
};
export function newRepository({repo,id,work,env=setupEnv()}) {
  const dir=join(work,'seed');
  mkdirSync(dir,{recursive:true});
  for(const [path,content] of Object.entries(fixture(id))) write(dir,path,content);
  git(dir,['init','-q','-b','main'],env);
  git(dir,['add','-A'],env);
  git(dir,[...SEED_AUTHOR,'commit','-qm','Initial commit'],env);
  gh(['repo','create',repo,'--public','--disable-wiki'],{env});
  git(dir,['remote','add','origin','https://github.com/'+repo+'.git'],env);
  gitPush(dir,env,'HEAD:main');
  return dir;
}
/**
 * Neutral GitHub Projects v2 setup, not TicketFlow's workflow.
 * Every cell gets its own initially empty board, identically for all arms.
 * TicketFlow may configure that board using its OWN setup when its arm installs.
 */
const graphql=(query,variables={},env=setupEnv())=>{
  const args=['api','graphql','-f','query='+query];
  for(const [key,value] of Object.entries(variables)) args.push('-f',key+'='+String(value));
  const result=JSON.parse(gh(args,{env}));
  if(result.errors?.length)throw Error('GitHub GraphQL: '+JSON.stringify(result.errors).slice(0,600));
  return result.data;
};
export function projectUrl({owner,number,ownerType='organization'}) {
  return 'https://github.com/'+(ownerType==='user'?'users':'orgs')+'/'+owner+'/projects/'+number;
}
const projectOwnerFields='id projectsV2(first:100){nodes{id number title repositories(first:100){nodes{nameWithOwner} pageInfo{hasNextPage}}} pageInfo{hasNextPage}}';
const projectOwnerSelection=(ownerType)=>{
  if(ownerType==='organization')return 'organization(login:$owner){'+projectOwnerFields+'}';
  if(ownerType==='user')return 'user(login:$owner){'+projectOwnerFields+'}';
  throw Error('unsupported Project owner type '+ownerType);
};
// owners are lowercased here, but GitHub reports the login in its own case
const sameRepo=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export function findProject({owner,title,repo,ownerType='organization',env=setupEnv()}) {
  if(typeof repo!=='string'||!repo.includes('/'))throw Error('cleanup Project recovery requires a repository identity');
  const data=graphql('query($owner:String!){'+projectOwnerSelection(ownerType)+'}',
    {owner},env);
  const account=ownerType==='user'?data.user:data.organization;
  if(!account)throw Error('Project owner is not accessible');
  const projects=account.projectsV2;
  const matches=projects.nodes.filter(p=>p.title===title);
  if(matches.length>1 || projects.pageInfo.hasNextPage)
    throw Error('Project lookup is ambiguous; owner has too many projects');
  if(!matches.length)return null;
  const project=matches[0],repositories=project.repositories;
  if(!repositories||repositories.pageInfo?.hasNextPage||!repositories.nodes.some(r=>sameRepo(r.nameWithOwner,repo)))
    throw Error('Project identity is not associated with recorded repository '+repo);
  return {...project,owner,owner_type:ownerType};
}
export function linkProject({repo,owner,title,ownerType='organization',env=setupEnv()}) {
  const data=graphql('query($owner:String!,$repo:String!){'+projectOwnerSelection(ownerType)+' repository(owner:$owner,name:$repo){id}}',
    {owner,repo:repo.split('/')[1]},env);
  const account=ownerType==='user'?data.user:data.organization;
  if(!account||!data.repository)throw Error('Project owner or repository not accessible');
  const projects=account.projectsV2;
  const matches=projects.nodes.filter(p=>p.title===title);
  if(matches.length>1 || projects.pageInfo.hasNextPage)
    throw Error('Project lookup is ambiguous; owner has too many projects');
  if(matches.length) {
    const project=matches[0],repositories=project.repositories;
    if(!repositories||repositories.pageInfo?.hasNextPage||!repositories.nodes.some(r=>sameRepo(r.nameWithOwner,repo)))
      throw Error('Project title collision is not associated with recorded repository '+repo);
    return {...project,owner,owner_type:ownerType};
  }
  const created=graphql('mutation($o:ID!,$r:ID!,$t:String!){createProjectV2(input:{ownerId:$o,repositoryId:$r,title:$t}){projectV2{id number}}}',
    {o:account.id,r:data.repository.id,t:title},env).createProjectV2.projectV2;
  if(!created?.id||!created?.number)throw Error('GitHub Project not created');
  return {...created,owner,owner_type:ownerType};
}
export function deleteProject({projectId,env=setupEnv()}) {
  if(typeof projectId!=='string'||!/^PVT_/.test(projectId))throw Error('invalid recorded Project ID');
  try {
    const deleted=graphql('mutation($id:ID!){deleteProjectV2(input:{projectId:$id}){projectV2{id}}}',{id:projectId},env).deleteProjectV2?.projectV2?.id;
    if(deleted!==projectId)throw Error('GitHub did not confirm Project deletion for '+projectId);
    return 'deleted';
  } catch(e) {
    if(/not found|could not resolve|does not exist/i.test(e.message))return 'absent';
    throw e;
  }
}
export function deleteRepository({repo,env=setupEnv()}) {
  if(!/^[a-z0-9-]+\/[a-z0-9.-]+$/i.test(repo))throw Error('invalid recorded repository '+repo);
  try {
    gh(['repo','delete',repo,'--yes'],{env});
    return 'deleted';
  } catch(e) {
    if(/404|not found|could not resolve|does not exist/i.test(e.message))return 'absent';
    throw e;
  }
}
/** Creates the scenario's tickets in order ({#n} in a body becomes the number of ticket n) and adds them to the board. Returns the numbers. */
export function seedIssues({repo,id,projectId,env=setupEnv()}) {
  const issues=[];
  for(const issue of scenarios[id].issues) {
    const url=gh(['issue','create','-R',repo,'--title',issue.title,'--body',fillIssue(issue.body,{issues})],{env});
    const n=Number(url.match(/\/issues\/(\d+)$/)?.[1]);
    if(!n)throw Error('unexpected issue URL '+url);
    issues.push(n);
    const row=JSON.parse(gh(['api','repos/'+repo+'/issues/'+n],{env}));
    graphql('mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}',
      {p:projectId,c:row.node_id},env);
  }
  return issues;
}
/** Opens the scenario's seeded pull request, if it has one, and leaves its comment. Returns {number,commentId} or null. */
export function seedPR({repo,id,work,env=setupEnv()}) {
  const seed=scenarios[id].seedPR;
  if(!seed) return null;
  const dir=join(work,'seed');
  git(dir,['fetch','origin','main'],env);
  git(dir,['checkout','main'],env);
  git(dir,['reset','--hard','origin/main'],env);
  git(dir,['checkout','-qb',seed.branch],env);
  for(const [path,source] of Object.entries(seed.changes)) write(dir,path,source);
  git(dir,['add','-A'],env);
  git(dir,[...SEED_AUTHOR,'commit','-qm',seed.commitMessage],env);
  gitPush(dir,env,'HEAD:'+seed.branch);
  git(dir,['checkout','main'],env);
  const url=gh(['pr','create','-R',repo,'--head',seed.branch,'--base','main','--title',seed.title,'--body',seed.body],{env});
  const number=Number(url.match(/\/pull\/(\d+)$/)?.[1]);
  if(!number) throw Error('unexpected PR URL '+url);
  // The seed actor cannot formally review its own PR, so the finding is a plain comment; its id is recorded to tell it from agent activity.
  const comment=JSON.parse(gh(['api','repos/'+repo+'/issues/'+number+'/comments','-f','body='+seed.comment],{env}));
  if(!comment.id) throw Error('seed comment was not created');
  return {number,commentId:comment.id};
}
export function cloneRepository(repo,root,env=setupEnv()) {
  const dir=join(root,'repo');mkdirSync(root,{recursive:true});
  gh(['repo','clone',repo,dir,'--','--depth','1'],{env});
  git(dir,['config','credential.helper','!gh auth git-credential'],env);
  git(dir,['config','user.name','Developer'],env);
  git(dir,['config','user.email','developer@example.invalid'],env);
  return dir;
}
/** Probe the permission TicketFlow's local fallback needs before starting a paid agent. */
export function probeCommitStatusWrite({repo,sha,env=setupEnv(),context='preflight/status-write'}) {
  if(!/^[0-9a-f]{40}$/i.test(sha))throw Error('commit status preflight requires a full commit SHA');
  gh(['api','repos/'+repo+'/statuses/'+sha,'-f','state=success','-f','context='+context,
    '-f','description=status write check'],{env});
  return context;
}
export function installTicketFlow({repo,dir,source,agent,owner,projectNumber,title,issues=[],env=setupEnv()}) {
  write(dir,'.ticketflow/config.json',JSON.stringify(cfg(repo,owner,projectNumber,agent,title)));
  sh('node',[join(source,'core/scripts/runtime.mjs'),source,dir],{cwd:dir,env});
  sh('node',[join(dir,'.ticketflow/scripts/gen-stubs.mjs'),join(dir,'.ticketflow'),dir],{cwd:dir,env});
  sh('node',[join(dir,'.ticketflow/scripts/render.mjs'),join(dir,'.ticketflow/templates'),dir],{cwd:dir,env});
  git(dir,['add','-A'],env);
  git(dir,['-c','user.name=Maintainer','-c','user.email=maintainer@example.invalid','commit','-qm','Add project tooling'],env);
  gitPush(dir,env,'HEAD:main');
  // Only the TicketFlow arm configures its Project lifecycle and Ready queue.
  sh(process.execPath,[join(dir,'.ticketflow/scripts/project.mjs'),'setup'],{cwd:dir,env});
  for(const issue of issues) sh(process.execPath,[join(dir,'.ticketflow/scripts/project.mjs'),'status',String(issue),'Ready'],{cwd:dir,env});
}
export function cleanupLocal(work) {rmSync(work,{recursive:true,force:true});}
// Claude Code loads instruction and settings files from every parent directory of its working directory, so a stray
// AGENTS.md or CLAUDE.md above the work area would reach every arm. Fail closed instead of measuring a contaminated run.
const GUIDANCE=['CLAUDE.md','CLAUDE.local.md','AGENTS.md','GEMINI.md','.claude/CLAUDE.md','.claude/settings.json','.claude/settings.local.json','.codex/config.toml','.agents'];
export function ancestorGuidance(dir){
  const found=[];
  for(let d=dirname(resolve(dir));;d=dirname(d)){
    for(const name of GUIDANCE) if(existsSync(join(d,name))) found.push(join(d,name));
    if(dirname(d)===d) break;
  }
  return found;
}
export function newWork(){
  const base=process.env.BENCHMARK_WORK_ROOT||tmpdir();
  mkdirSync(base,{recursive:true});
  const work=mkdtempSync(join(base,'work-'));
  const found=process.env.BENCHMARK_ALLOW_ANCESTOR_GUIDANCE==='1'?[]:ancestorGuidance(work);
  if(found.length){
    rmSync(work,{recursive:true,force:true});
    throw Error('instruction or settings files above the work area would be loaded by every agent: '+found.join(', ')+
      '. Set BENCHMARK_WORK_ROOT to a directory whose parents have none (for example /var/tmp/benchmark).');
  }
  return work;
}
