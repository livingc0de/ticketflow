/** Real GitHub fixture setup. Paid runs are opt-in, repos are disposable. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fixture, scenarios } from './scenarios.mjs';

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
export const cfg=(repo,owner,number,agent='claude',title='Workflow benchmark')=>({
  schema_version:2,repo,default_branch:'main',verify:{mode:'ci',command:'npm test'},
  project:{owner,number,title},agents:[agent],
  models:{[agent]:{strong:null,standard:null,light:null}}
});
const gitPush=(dir,env,ref)=>{
  git(dir,['-c','credential.helper=!gh auth git-credential','push','origin',ref],env);
};
export function newRepository({repo,id,work,env=setupEnv()}) {
  const dir=join(work,'seed');
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
export function seedIssues({repo,id,projectId,env=setupEnv()}) {
  const issues=[];
  for(const [index,body] of scenarios[id].issues.entries()) {
    const url=gh(['issue','create','-R',repo,'--title',id+' benchmark: '+(index+1),'--body',body],{env});
    const n=Number(url.match(/\/issues\/(\d+)$/)?.[1]);
    if(!n)throw Error('unexpected issue URL '+url);
    issues.push(n);
    const issue=JSON.parse(gh(['api','repos/'+repo+'/issues/'+n],{env}));
    graphql('mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}',
      {p:projectId,c:issue.node_id},env);
  }
  if(id==='W3' && issues.length===3) {
    const body=scenarios.W3.issues[2]+'\n\nDepends on #'+issues[0]+', #'+issues[1]+'.';
    gh(['issue','edit',String(issues[2]),'-R',repo,'--body',body],{env});
  }
  return issues;
}
export function seedBrokenPull({repo,id,work,issue,env=setupEnv()}) {
  const sc=scenarios[id];
  if(!sc.seedBrokenPR) return null;
  const dir=join(work,'seed');
  git(dir,['fetch','origin','main'],env);
  git(dir,['checkout','main'],env);
  git(dir,['reset','--hard','origin/main'],env);
  git(dir,['checkout','-qb',sc.seedBrokenPR.branch],env);
  for(const [path,source] of Object.entries(sc.seedBrokenPR.changes)) write(dir,path,source);
  git(dir,['add','-A'],env);
  git(dir,['-c','user.name=workflow-bench','-c','user.email=workflow-bench@example.invalid','commit','-qm','introduce regression for review'],env);
  gitPush(dir,env,'HEAD:'+sc.seedBrokenPR.branch);
  const url=gh(['pr','create','-R',repo,'--head',sc.seedBrokenPR.branch,'--base','main',
    '--title','Repair incoming webhook PR','--body','Refs #'+issue+' (benchmark fixture)'],{env});
  const number=Number(url.match(/\/pull\/(\d+)$/)?.[1]);
  if(!number) throw Error('unexpected PR URL '+url);
  // A fixture comment records the supplied review finding. A seed actor cannot formally review its own PR.
  gh(['pr','comment',String(number),'-R',repo,'--body',sc.seedBrokenPR.review],{env});
  return number;
}
export function cloneRepository(repo,root,env=setupEnv()) {
  const dir=join(root,'repo');mkdirSync(root,{recursive:true});
  gh(['repo','clone',repo,dir,'--','--depth','1'],{env});
  git(dir,['config','credential.helper','!gh auth git-credential'],env);
  git(dir,['config','user.name','workflow-benchmark-agent'],env);
  git(dir,['config','user.email','workflow-benchmark@example.invalid'],env);
  return dir;
}
/** Probe the permission TicketFlow's local fallback needs before starting a paid agent. */
export function probeCommitStatusWrite({repo,sha,env=setupEnv(),context='ticketflow-benchmark/preflight'}) {
  if(!/^[0-9a-f]{40}$/i.test(sha))throw Error('commit status preflight requires a full commit SHA');
  gh(['api','repos/'+repo+'/statuses/'+sha,'-f','state=pending','-f','context='+context,
    '-f','description=TicketFlow benchmark status-write preflight'],{env});
  return context;
}
export function installTicketFlow({repo,dir,source,agent,owner,projectNumber,title,issues=[],env=setupEnv()}) {
  write(dir,'.ticketflow/config.json',JSON.stringify(cfg(repo,owner,projectNumber,agent,title)));
  sh('node',[join(source,'core/scripts/runtime.mjs'),source,dir],{cwd:dir,env});
  sh('node',[join(dir,'.ticketflow/scripts/gen-stubs.mjs'),join(dir,'.ticketflow'),dir],{cwd:dir,env});
  sh('node',[join(dir,'.ticketflow/scripts/render.mjs'),join(dir,'.ticketflow/templates'),dir],{cwd:dir,env});
  git(dir,['add','-A'],env);
  git(dir,['-c','user.name=workflow-bench','-c','user.email=workflow-bench@example.invalid','commit','-qm','install TicketFlow benchmark runtime'],env);
  gitPush(dir,env,'HEAD:main');
  // Only the TicketFlow arm configures its Project lifecycle and Ready queue.
  sh(process.execPath,[join(dir,'.ticketflow/scripts/project.mjs'),'setup'],{cwd:dir,env});
  for(const issue of issues) sh(process.execPath,[join(dir,'.ticketflow/scripts/project.mjs'),'status',String(issue),'Ready'],{cwd:dir,env});
}
export function cleanupLocal(work) {rmSync(work,{recursive:true,force:true});}
export function newWork(){return mkdtempSync(join(tmpdir(),'tf-workflow-'));}
