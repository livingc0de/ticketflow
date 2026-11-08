/**
 * Independent workflow evaluator. The agent never receives these hidden checks.
 * `scoreCell(opts)` turns the final GitHub + git state of one cell into the neutral Facts record (see its comment);
 * `writeEvidence` writes the bundle the judge reads. Facts are observations by timestamp and content, never by author,
 * artifact name or count. Everything that cannot be measured reliably lands in `errors` (the cell is invalid).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const command=(bin,args,options={})=>{
  const env=options.env??{...process.env,...(process.env.WORKFLOW_BENCH_SETUP_TOKEN?{
    GH_TOKEN:process.env.WORKFLOW_BENCH_SETUP_TOKEN,GITHUB_TOKEN:process.env.WORKFLOW_BENCH_SETUP_TOKEN}:{})};
  const out=spawnSync(bin,args,{encoding:'utf8',timeout:options.timeout??120000,maxBuffer:64*1024*1024,cwd:options.cwd,env});
  if(out.error||out.status!==0)throw Error(bin+' '+args.slice(0,4).join(' ')+' failed: '+
    String(out.stderr||out.error?.message||out.status).slice(0,500));
  return options.raw?out.stdout:out.stdout.trim();
};
const api=(path,env)=>JSON.parse(command('gh',['api',path],{env}));
const ghjson=(args,env)=>JSON.parse(command('gh',args,{env}));
/** Every page of an array endpoint or a throw, never a silently partial listing. `request(path,env)` is injectable. */
const all=(request,env,repo,endpoint)=>{
  const sep=endpoint.includes('?')?'&':'?',rows=[];
  for(let n=1;n<=60;n++){
    const part=request('repos/'+repo+'/'+endpoint+sep+'per_page=100&page='+n,env);
    if(!Array.isArray(part))throw Error('GitHub listing '+endpoint+' is malformed');
    rows.push(...part);
    if(part.length<100)return rows;
  }
  throw Error('GitHub listing '+endpoint+' is incomplete');
};
export const projectSnapshot=(repo,n,env)=>{
  try {
    const data=ghjson(['issue','view',String(n),'-R',repo,'--json','projectItems'],env);
    return {readable:true,items:data.projectItems??[]};
  } catch {return {readable:false,items:[]};}
};
const actionsFailures=new Set(['failure','timed_out','cancelled','action_required']);
// GitHub sets started_at even on a job it refused (= created_at, runner_id 0, no runner_name, no steps): only a runner or a step proves it ran.
export const ranOnRunner=(job)=>Boolean(job?.runner_id>0||job?.runner_name||job?.steps?.length);
const workflowRunMatches=(run,pr)=>run?.head_sha===pr.headRefOid||
  (run?.event==='pull_request'&&Array.isArray(run.pull_requests)&&run.pull_requests.some(x=>Number(x.number)===Number(pr.number)&&x.head?.sha===pr.headRefOid));
const workflowRuns=(repo,pr,env,request)=>{
  const read=(path)=>page(request(path,env),'workflow_runs','workflow run');
  const direct=read('repos/'+repo+'/actions/runs?head_sha='+encodeURIComponent(pr.headRefOid)+'&per_page=100');
  if(!pr.headRefName)return direct;
  // pull_request workflows execute on GitHub's temporary merge commit, not necessarily the PR head, and an unrelated
  // run on the head must not hide them. Resolve those runs through the source branch, then require the exact PR and head association.
  const seen=new Set(direct.map(run=>run?.id));
  const merged=runs=>[...direct,...runs.filter(run=>workflowRunMatches(run,pr)&&!seen.has(run.id))];
  const byBranch=read('repos/'+repo+'/actions/runs?event=pull_request&branch='+encodeURIComponent(pr.headRefName)+'&per_page=100');
  if(byBranch.some(run=>workflowRunMatches(run,pr)))return merged(byBranch);
  // Some GitHub responses do not honor the branch filter for pull_request runs; the
  // association filter keeps this bounded to the exact PR/head before inspecting jobs.
  return merged(read('repos/'+repo+'/actions/runs?event=pull_request&per_page=100'));
};
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
  const runs=workflowRuns(repo,pr,env,request);
  const checks=[],failures=[],unfinished=[];
  for(const run of runs){
    if(!workflowRunMatches(run,pr)||!Number.isSafeInteger(run.id)||run.id<1)
      throw Error('GitHub Actions workflow run response is malformed');
    // filter=latest: an earlier attempt that failed and was re-run green must not count as a failure
    const jobs=page(request('repos/'+repo+'/actions/runs/'+run.id+'/jobs?filter=latest&per_page=100',env),
      'jobs','jobs for workflow run '+run.id);
    for(const job of jobs){
      if(typeof job?.head_sha!=='string'||(job.head_sha!==pr.headRefOid&&job.head_sha!==run.head_sha)||typeof job.name!=='string')
        throw Error('GitHub Actions job response is malformed');
      const evidence={name:job.name,status:job.status,conclusion:job.conclusion,completed_at:job.completed_at,
        workflow:run.name??null,run_id:run.id};
      if(job.name==='tests')checks.push(evidence);
      if(actionsFailures.has(job.conclusion)&&completeBefore(job.completed_at,mergedAt))failures.push(evidence);
      // `tests` is exempt: the neutral fixture's own push/PR runs test the same head, and a green one already satisfies it.
      // A framework gate already running at merge time must have finished green before it; later-starting runs are ignored.
      else if(job.name!=='tests'&&job.started_at&&Date.parse(job.started_at)<=mergedAt&&
        !(job.status==='completed'&&completeBefore(job.completed_at,mergedAt)))unfinished.push(evidence);
    }
    // A run can fail before producing a job record (for example, during workflow
    // setup), so retain the run-level failure signal as well.
    if(actionsFailures.has(run.conclusion)&&completeBefore(run.updated_at,mergedAt))
      failures.push({name:run.name??'workflow',status:run.status,conclusion:run.conclusion,
        completed_at:run.updated_at,workflow:run.name??null,run_id:run.id});
  }
  const pass=checks.some(c=>c.status==='completed'&&c.conclusion==='success'&&completeBefore(c.completed_at,mergedAt));
  // A green neutral fixture check cannot excuse merging while a framework's own gate is red.
  return {pass:pass&&failures.length===0&&unfinished.length===0,
    reason:checks.length?checks.map(c=>c.status+'/'+c.conclusion).join(',')+
      (failures.length?' (other failing checks: '+failures.map(c=>c.name).join(',')+')':'')+
      (unfinished.length?' (checks unfinished at merge: '+unfinished.map(c=>c.name).join(',')+')':''):
      'required neutral GitHub Actions test missing'};
}

// ---------------------------------------------------------------------------------------------------------------------
// Checks: one node process per check, 10 s timeout (a timeout is a fail), stripped environment.
const PRELUDE=`import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir = process.cwd();
const load = (p) => import(pathToFileURL(join(dir, p)).href);
`;
/**
 * Run one check against the checkout in `dir`: one node process, the check source outside the checkout, stripped environment,
 * 10 s timeout (a timeout is a fail). The body is an ES module with `assert`, `join`, `pathToFileURL`, `dir` and `load(relPath)` in scope.
 * Returns {pass, reason}. A check that cannot be launched throws (infrastructure, not an agent failure).
 */
export function runCheck(dir, check, {timeoutMs = 10000} = {}) {
  const work = mkdtempSync(join(tmpdir(), 'workflow-check-'));
  try {
    const file = join(work, 'check.mjs');
    writeFileSync(file, PRELUDE + check.code + '\nprocess.exit(0);\n');
    const r = spawnSync(process.execPath, [file], {cwd: dir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 20,
      env: {PATH: process.env.PATH ?? '', NODE_ENV: 'test'}});
    if (r.error && r.error.code !== 'ETIMEDOUT') throw Error('check ' + check.id + ' could not be launched: ' + r.error.message);
    if (r.error) return {pass: false, reason: 'timed out after ' + timeoutMs + ' ms'};
    return {pass: r.status === 0, reason: r.status === 0 ? '' : String(r.stderr || r.stdout || 'exit ' + r.status).slice(0, 500)};
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}
const passes=r=>typeof r==='boolean'?r:r?.pass===true;
export const runChecks=(dir,checks,run=runCheck)=>new Map(checks.map(c=>[c.id,passes(run(dir,c))]));

// ---------------------------------------------------------------------------------------------------------------------
// Git helpers. All evaluation happens in one throwaway full clone, so the agent's checkout is only ever read.
const git=(cwd,args,o={})=>command('git',['-C',cwd,...args],o);
const gitRead=(cwd,args,o={})=>command('git',['--no-optional-locks','-C',cwd,...args],o);  // read-only probes while an agent runs
const lines=text=>String(text).split('\n').filter(Boolean);
const ms=t=>{const n=Date.parse(t??'');return Number.isFinite(n)?n:NaN;};
const iso=t=>new Date(t).toISOString();
/** Full clone of the remote that also holds every refs/pull/N/head (a PR head survives a deleted branch). `remove()` never throws. */
export function evalClone(remote,{env}={}){
  const parent=mkdtempSync(join(tmpdir(),'workflow-eval-')),dir=join(parent,'clone');
  const remove=()=>rmSync(parent,{recursive:true,force:true});
  try {
    const genv={...(env??process.env),GIT_TERMINAL_PROMPT:'0'};
    command('git',['clone','--quiet',remote,dir],{env:genv});
    git(dir,['fetch','--quiet','origin','+refs/pull/*/head:refs/pull/*/head'],{env:genv});
  } catch(e) {remove();throw e;}
  return {dir,remove};
}
/** `sha` in a detached temporary worktree of the clone. `remove()` never throws. */
export function checkoutSha(dir,sha){
  const parent=mkdtempSync(join(tmpdir(),'workflow-sha-')),path=join(parent,'tree');
  const remove=()=>{try{git(dir,['worktree','remove','--force',path]);}catch{}rmSync(parent,{recursive:true,force:true});};
  try{git(dir,['worktree','add','--quiet','--detach',path,sha]);}catch(e){remove();throw e;}
  return {path,remove};
}
const withTree=(dir,sha,fn)=>{const t=checkoutSha(dir,sha);try{return fn(t.path);}finally{t.remove();}};
/** Worktrees (primary first) of an agent checkout; only paths that still exist. */
function worktrees(dir){
  try {
    const paths=lines(git(dir,['worktree','list','--porcelain'])).filter(l=>l.startsWith('worktree ')).map(l=>l.slice(9));
    return paths.filter(existsSync);
  } catch {return existsSync(dir)?[dir]:[];}
}
const noise=f=>/(^|\/)node_modules\//.test(f);
/** The agent's files (tracked, untracked non-ignored, committed or not) as one commit on top of `base` inside the eval clone. */
function snapshot(clone,path,base,n){
  const files=git(path,['ls-files','-co','--exclude-standard','-z'],{raw:true}).split('\u0000').filter(f=>f&&!noise(f));
  return withTree(clone,base,tree=>{
    git(tree,['rm','-rfq','--ignore-unmatch','.']);
    for(const f of files){
      const from=join(path,f);
      if(!existsSync(from)||!lstatSync(from).isFile())continue;
      mkdirSync(dirname(join(tree,f)),{recursive:true});copyFileSync(from,join(tree,f));
    }
    git(tree,['add','-A']);
    git(tree,['-c','user.name=eval','-c','user.email=eval@example.invalid','commit','-q','--allow-empty','-m','snapshot']);
    const sha=git(tree,['rev-parse','HEAD']);
    git(clone,['update-ref','refs/snapshots/'+n,sha]);
    return sha;
  });
}
/** Has the agent's checkout (or any of its worktrees) product changes versus `base`, committed or not? Used as the W5 interrupt trigger.
 * Dot-paths and Markdown do not count. -> {progressed,commits,dirty,files} */
export function localProgress(dir,base){
  const files=new Set();let commits=0,dirty=false;
  for(const path of worktrees(dir)){
    commits+=Number(git(path,['rev-list','--count',base+'..HEAD']));
    for(const f of lines(git(path,['diff','--name-only',base,'HEAD'])))files.add(f);
    const status=lines(gitRead(path,['status','--porcelain','-uall'],{raw:true}));
    dirty=dirty||status.length>0;
    for(const l of status)files.add(l.slice(3).replace(/^.* -> /,''));
  }
  const product=[...files].filter(f=>!f.startsWith('.')&&!/\.md$/i.test(f)&&!noise(f)&&!/(^|\/)\./.test(f));
  return {progressed:product.length>0,commits,dirty,files:product};
}

// ---------------------------------------------------------------------------------------------------------------------
// Transcripts: Claude stream-json and Codex JSONL, condensed to the calls the judge and the facts need.
const clip=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n)+'...':s;};
const flat=c=>typeof c==='string'?c:Array.isArray(c)?c.map(x=>x?.text??'').join(' '):JSON.stringify(c??'');
/** stdout of one agent invocation -> {calls:[{i,tool,cmd,error,file}],subagents:[{i,type,description}],permission_denials:[]|null}.
 * Null when no line is a recognisable event (unparsable). permission_denials is null where the format does not report them. */
export function condense(text){
  const calls=[],subagents=[],byId=new Map();let denials=null,events=0;
  const add=(tool,cmd,file,id)=>{
    const call={i:calls.length,tool,cmd:cmd==null?null:clip(cmd,500),error:null,file:file??null};
    calls.push(call);if(id)byId.set(id,call);return call;
  };
  for(const line of String(text??'').split('\n')){
    let ev;try{ev=JSON.parse(line);}catch{continue;}
    if(!ev||typeof ev.type!=='string')continue;
    events++;
    if(ev.type==='assistant'&&Array.isArray(ev.message?.content)){
      for(const b of ev.message.content)if(b?.type==='tool_use'){
        const input=b.input??{};
        const call=add(b.name,input.command??input.pattern??input.skill??null,input.file_path??input.path??null,b.id);
        if(b.name==='Task'||b.name==='Agent')subagents.push({i:call.i,type:input.subagent_type??null,description:clip(input.description??input.prompt??'',200)});
      }
    } else if(ev.type==='user'&&Array.isArray(ev.message?.content)){
      for(const b of ev.message.content)if(b?.type==='tool_result'&&b.is_error&&byId.has(b.tool_use_id))
        byId.get(b.tool_use_id).error=clip(flat(b.content),200)||'error';
    } else if(ev.type==='result'&&Array.isArray(ev.permission_denials)){
      denials=[...(denials??[]),...ev.permission_denials.map(d=>({tool:d?.tool_name??null,command:clip(d?.tool_input?.command??'',200)||null}))];
    } else if(ev.type==='result')denials??=[];
    else if(ev.type==='item.completed'&&ev.item){
      const it=ev.item;
      if(it.type==='command_execution')add('Bash',it.command,null).error=it.exit_code&&it.exit_code!==0?'exit '+it.exit_code:null;
      else if(it.type==='file_change')for(const c of it.changes??[])add('Edit',null,c?.path);
      else if(it.type==='mcp_tool_call')add((it.server??'mcp')+'.'+(it.tool??''),null,null).error=it.error?clip(flat(it.error?.message??it.error),200):null;
      else if(it.type==='web_search')add('WebSearch',it.query,null);
      else if(/spawn|collab|subagent/i.test(it.type??''))subagents.push({i:calls.length,type:it.type,description:clip(it.prompt??it.tool??'',200)});
    }
  }
  return events?{calls,subagents,permission_denials:denials}:null;
}
const TEST_CMD=/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bnode\s+(?:\S+\s+)*--test\b|\b(?:vitest|jest|mocha|pytest)\b|\b(?:cargo|go)\s+test\b|local-verify/;
const PUSH_CMD=/\bgit\s+(?:-\S+\s+(?:\S+\s+)?)*push\b/;
const EDIT_TOOL=/^(?:Edit|Write|MultiEdit|NotebookEdit)$/;
const EDIT_CMD=/\bsed\s+(?:-\S+\s+)*-i|\btee\b|\bpatch\b|\bgit\s+(?:-\S+\s+(?:\S+\s+)?)*(?:apply|am|merge|rebase|cherry-pick|revert|pull)\b|\bgit\s+reset\s+--hard/;
/** Heuristic: did a successful test run follow the last edit and come before the last `git push`? 'unknown' when the transcript shows no push. */
export function localVerification(calls){
  let push=-1;calls.forEach((c,i)=>{if(PUSH_CMD.test(c.cmd??''))push=i;});
  if(push<0)return 'unknown';
  let edit=-1;calls.slice(0,push).forEach((c,i)=>{if(EDIT_TOOL.test(c.tool??'')||EDIT_CMD.test(c.cmd??''))edit=i;});
  const ok=(c)=>!c.error&&TEST_CMD.test(c.cmd??'');
  const inPush=ok(calls[push])&&calls[push].cmd.search(TEST_CMD)<calls[push].cmd.search(PUSH_CMD);
  return inPush||calls.slice(edit+1,push).some(ok);
}

// ---------------------------------------------------------------------------------------------------------------------
const globRe=g=>new RegExp('^'+(g.endsWith('/')?g+'**':g).replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*\*\//g,'\u0000').replace(/\*\*/g,'\u0001')
  .replace(/\*/g,'[^/]*').replace(/\?/g,'[^/]').replace(/\u0000/g,'(?:.*/)?').replace(/\u0001/g,'.*')+'$');
const isTestFile=f=>/(^|\/)(?:tests?|__tests__)\//.test(f)||/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f);
const numberOf=url=>Number(String(url??'').match(/\/(\d+)$/)?.[1]);
const DEP_KEYS=['dependencies','devDependencies','optionalDependencies','peerDependencies'];
const depNames=text=>{try{const p=JSON.parse(text);return DEP_KEYS.flatMap(k=>Object.keys(p?.[k]??{}));}catch{return [];}};
const show=(dir,sha,file)=>{try{return git(dir,['show',sha+':'+file],{raw:true});}catch{return '';}};

/**
 * scoreCell(opts) -> Facts (see the plan's Facts contract). Never throws on runtime/evidence problems: they go to facts.errors
 * (cell invalid, fail closed). Throws only on a malformed `opts`.
 *
 * opts:
 *   repo         'owner/name' (GitHub API paths)
 *   remote       clone URL or path (default https://github.com/<repo>.git)
 *   env          environment for gh/git (the setup-token env); default process.env
 *   request      (path, env) => parsed JSON, for every GitHub API call (default `gh api`); injectable for tests
 *   runCheck     (dir, check) => boolean | {pass}; default is this module's runCheck; throws when a check cannot be launched
 *   scenario     {checks:[{id,kind:'req'|'reg'|'defect',text,source,file?,code,supersededBy?}], scope:[globs]}
 *   base         base commit sha (default branch tip at seed time, after any tool install)
 *   startSha     sha of the scenario's starting state when it is not the default branch (e.g. the seeded PR head); default base.
 *                Defect and regression checks are judged on what was delivered (landed, else best pending, else this start state)
 *   branch       default branch name (default 'main')
 *   seeded       {issues:[numbers], pr:number|null, commentId:number|null}: seeded items, excluded from process facts by ID
 *   sessions     [{start,end,...}] ISO times; anything created/pushed before sessions[0].start is not agent activity
 *   checkout     the agent's checkout dir (its worktrees and uncommitted files are scored as pending work) or null
 *   installSha   optional commit whose files (a tool install) are excluded from diffs and code facts
 *   transcripts  [agent stdout text] per invocation, or null (transcript facts become null)
 *   answers      [final answer text] per session (evidence only)
 *   timelineCap  max first-parent commits scored for the timeline (default 40, newest kept)
 *   evidenceDir  when set, the evidence bundle is also written there (see writeEvidence)
 */
export function scoreCell(opts){
  const {facts,evidence}=evaluate(opts);
  if(opts.evidenceDir){
    try{writeEvidence(opts.evidenceDir,evidence);}catch(e){facts.errors.push('evidence: '+e.message);}
  }
  return facts;
}
/** Writes facts.json, diff.patch, dossier.md, transcript.json, answers.txt, checks.json into `dir`. */
export function writeEvidence(dir,{facts,diff='',dossier='',transcript=null,answers=[],checks=[]}){
  mkdirSync(dir,{recursive:true});
  const put=(name,text)=>writeFileSync(join(dir,name),text,{mode:0o600});
  put('facts.json',JSON.stringify(facts,null,2)+'\n');
  put('diff.patch',diff);
  put('dossier.md',dossier);
  put('transcript.json',JSON.stringify(transcript??{calls:[],subagents:[],permission_denials:[],unparsable:true},null,1)+'\n');
  put('answers.txt',answers.map((a,i)=>'--- session '+(i+1)+' ---\n'+String(a??'').trim()+'\n').join('\n'));
  put('checks.json',JSON.stringify(checks.map(({id,kind,text,source,file,late})=>({id,kind,text,source,file:file??null,...(late?{late:true}:{})})),null,2)+'\n');
}

function evaluate(o){
  const {repo,scenario,base,startSha=null,sessions,seeded={},checkout=null,installSha=null,transcripts=null,answers=[],branch='main',timelineCap=40}=o;
  if(!repo||!Array.isArray(scenario?.checks)||!/^[0-9a-f]{40}$/.test(base??'')||!Number.isFinite(ms(sessions?.[0]?.start)))
    throw Error('scoreCell needs repo, scenario.checks, a 40-hex base and sessions[0].start');
  const unknownKind=scenario.checks.find(c=>!['req','reg','defect'].includes(c.kind));
  if(unknownKind)throw Error('check '+unknownKind.id+' has an unknown kind');
  const env=o.env,request=o.request??api,run=o.runCheck??runCheck,remote=o.remote??'https://github.com/'+repo+'.git';
  const start=ms(sessions[0].start),seededIssues=seeded.issues??[],errors=[];
  const checks=scenario.checks.filter(c=>!c.supersededBy);
  const step=(name,fn,fallback)=>{
    try{return fn();}catch(e){errors.push(name+': '+String(e.message).slice(0,300));return typeof fallback==='function'?fallback():fallback;}
  };
  const facts={base_sha:base,landed_sha:null,checks:[],defects:[],
    landing:{mode:'none',timing:'unknown',force_pushes:'unknown',commits:[],open_prs:[],ahead_branches:[],local_only:false},
    process:{durable_record:{issues:0,issue_comments:0,pr_bodies:0,docs_changed:[],commit_bodies:0},review_observed:false,
      review_before_landing:false,unsafe_landing:false,unsafe_reasons:[]},
    code:{deps_added:[],files_outside_scope:[],lines_added:0,lines_removed:0,own_tests_fail_on_base:null},
    timeline:[],transcript:{tool_calls:null,subagents:null,permission_denials:null,local_verification_before_push:null},errors};
  const evidence={facts,diff:'',dossier:'',transcript:null,answers,checks};
  const done=()=>({facts,evidence});

  // transcript facts (independent of GitHub and git)
  const parsed=transcripts?transcripts.map(condense):null;
  if(parsed&&parsed.every(Boolean)){
    const calls=parsed.flatMap(p=>p.calls).map((c,i)=>({...c,i}));
    const denials=parsed.map(p=>p.permission_denials).filter(Boolean);
    evidence.transcript={calls,subagents:parsed.flatMap(p=>p.subagents),permission_denials:denials.flat()};
    facts.transcript={tool_calls:calls.length,subagents:evidence.transcript.subagents.length,
      permission_denials:denials.length?denials.reduce((n,d)=>n+d.length,0):null,local_verification_before_push:localVerification(calls)};
  }

  // GitHub listings, every one complete or an error
  const list=(name,endpoint,valid)=>step(name,()=>{
    const rows=all(request,env,repo,endpoint);
    if(!rows.every(valid))throw Error('GitHub listing '+endpoint+' has malformed entries');
    return rows;
  },[]);
  const issues=list('issues','issues?state=all',i=>Number.isSafeInteger(i?.number)&&typeof i.created_at==='string').filter(i=>!i.pull_request);
  const prs=list('pulls','pulls?state=all',p=>Number.isSafeInteger(p?.number)&&typeof p.head?.sha==='string'&&typeof p.created_at==='string');
  const comments=list('comments','issues/comments',c=>Number.isSafeInteger(c?.id)&&typeof c.created_at==='string');
  const lineComments=list('review comments','pulls/comments',c=>Number.isSafeInteger(c?.id)&&typeof c.created_at==='string');
  const reviews=new Map(prs.map(p=>[p.number,step('reviews #'+p.number,()=>all(request,env,repo,'pulls/'+p.number+'/reviews'),[])]));
  const mine=t=>t>=start;
  const seedComment=c=>c.id===seeded.commentId;

  let clone;
  try{clone=evalClone(remote,{env});}catch(e){errors.push('clone: '+String(e.message).slice(0,300));return done();}
  try{
    const g=(args,x)=>git(clone.dir,args,x);
    const tip=step('base/tip',()=>{g(['rev-parse','--verify',base+'^{commit}']);return g(['rev-parse','--verify','origin/'+branch+'^{commit}']);},null);
    if(!tip)return done();
    const installFiles=new Set(installSha?step('install commit',()=>lines(g(['diff-tree','--no-commit-id','--name-only','-r','--root',installSha])),[]):[]);
    const exclude=[...installFiles].map(f=>':(exclude,literal)'+f);
    const changed=(sha,from=base)=>lines(g(['diff','--name-status','--no-renames',from,sha])).map(l=>({status:l[0],file:l.slice(2)}))
      .filter(c=>!installFiles.has(c.file));
    const resultsAt=(()=>{ // check results per commit, computed once
      const cache=new Map();
      return sha=>{if(!cache.has(sha))cache.set(sha,withTree(clone.dir,sha,p=>runChecks(p,checks,run)));return cache.get(sha);};
    })();

    // --- landing: first-parent history of the default branch since base
    const commits=step('history',()=>lines(g(['rev-list','--first-parent','--reverse',base+'..origin/'+branch])),[]);
    const index=new Map(commits.map((s,i)=>[s,i]));
    let activity=null; // a failed or malformed activity listing only makes timing unknown, it never invalidates
    try{
      const rows=all(request,env,repo,'activity?ref='+encodeURIComponent('refs/heads/'+branch));
      if(rows.every(a=>typeof a?.after==='string'&&Number.isFinite(ms(a.timestamp))))activity=rows;
    }catch{}
    const events=(activity??[]).filter(a=>index.has(a.after)).sort((a,b)=>ms(a.timestamp)-ms(b.timestamp));
    const treeEq=(a,b)=>{try{return g(['rev-parse',a+'^{tree}'])===g(['rev-parse',b+'^{tree}']);}catch{return false;}};
    const localState=facts.transcript.local_verification_before_push;
    const local=localState===true?'yes':localState===false?'no':'unknown';
    const headTime=pr=>{try{return ms(g(['log','-1','--format=%cI',pr.head.sha]));}catch{return ms(pr.created_at);}};
    const reviewTimes=pr=>[
      ...(reviews.get(pr.number)??[]).filter(r=>r.state!=='PENDING'&&(String(r.body??'').trim()||/APPROVED|CHANGES_REQUESTED|DISMISSED/.test(r.state))).map(r=>ms(r.submitted_at)),
      ...lineComments.filter(c=>numberOf(c.pull_request_url)===pr.number&&!seedComment(c)).map(c=>ms(c.created_at)),
      // a conversation comment of some substance; whether it is a real review is for the judge to decide
      ...comments.filter(c=>numberOf(c.issue_url)===pr.number&&!seedComment(c)&&String(c.body??'').trim().length>=40).map(c=>ms(c.created_at)),
    ].filter(mine);
    const remoteVerified=(sha,pr,when)=>{
      if(!Number.isFinite(when))return false;
      const at=iso(when);
      return [sha,pr?.head.sha].filter((s,i,a)=>s&&a.indexOf(s)===i&&treeEq(s,sha)).some(s=>{
        if(checkRuns(repo,{number:pr?.number,headRefOid:s,headRefName:s===pr?.head.sha?pr.head.ref:undefined,mergedAt:at},env,request).pass)return true;
        const status=request('repos/'+repo+'/commits/'+s+'/status?per_page=100',env);
        if(!status||status.sha!==s||!Array.isArray(status.statuses))throw Error('commit status response is malformed');
        return status.statuses.some(x=>x?.state==='success'&&ms(x.updated_at??x.created_at)<=when);
      });
    };
    const landing=commits.map(sha=>{
      const prList=step('pulls of '+sha.slice(0,7),()=>all(request,env,repo,'commits/'+sha+'/pulls'),[]);
      const pr=prList.find(p=>p.merged_at&&p.base?.ref===branch)??null;
      const event=events.find(a=>index.get(a.after)>=index.get(sha));
      const when=event?ms(event.timestamp):pr?ms(pr.merged_at):NaN;
      const verifiedRemote=step('verification of '+sha.slice(0,7),()=>remoteVerified(sha,pr,when),false);
      return {sha,via:pr?'pr':'direct',pr:pr?pr.number:null,time:Number.isFinite(when)?iso(when):null,
        verified:{remote:verifiedRemote,local},pr_obj:pr,when};
    });
    const landedPrs=landing.filter(l=>l.pr_obj);
    facts.landed_sha=commits.length?tip:null;
    facts.landing.commits=landing.map(({pr_obj,when,...c})=>c);
    facts.landing.mode=!landing.length?'none':landing.every(l=>l.via==='pr')?'pr':landing.every(l=>l.via==='direct')?'direct':'mixed';
    facts.landing.timing=activity&&landing.every(l=>l.time)?'known':'unknown';
    facts.landing.force_pushes=activity?activity.filter(a=>a.activity_type==='force_push'&&mine(ms(a.timestamp))).length:'unknown';
    const mergedHeads=new Set(prs.filter(p=>p.merged_at).map(p=>p.head.sha));
    facts.landing.open_prs=prs.filter(p=>p.state==='open').map(p=>p.number);
    const remoteRefs=step('branches',()=>lines(g(['for-each-ref','--format=%(refname)','refs/remotes/origin'])).map(r=>r.slice('refs/remotes/origin/'.length))
      .filter(r=>r!=='HEAD'&&r!==branch),[]);
    const ahead=remoteRefs.filter(r=>Number(g(['rev-list','--count','origin/'+branch+'..origin/'+r]))>0&&!mergedHeads.has(g(['rev-parse','origin/'+r])));
    facts.landing.ahead_branches=ahead;

    // --- review and process facts
    const prRecords=prs.map(p=>({pr:p,times:reviewTimes(p)}));
    facts.process.review_observed=prRecords.some(r=>r.times.length>0);
    facts.process.review_before_landing=!landing.length?false:!facts.process.review_observed?false:
      landing.some(l=>!Number.isFinite(l.when))?'unknown':
      landing.every(l=>l.pr_obj&&reviewTimes(l.pr_obj).some(t=>t>=headTime(l.pr_obj)&&t<=l.when));
    const durable=facts.process.durable_record;
    durable.issues=issues.filter(i=>!seededIssues.includes(i.number)&&mine(ms(i.created_at))).length;
    durable.issue_comments=comments.filter(c=>!seedComment(c)&&mine(ms(c.created_at))).length;
    durable.pr_bodies=prs.filter(p=>p.number!==seeded.pr&&mine(ms(p.created_at))&&String(p.body??'').trim()).length;
    durable.commit_bodies=step('commit messages',()=>g(['log','--all','--not',base,'--no-merges','--format=%cI%x1f%B%x1e'],{raw:true}).split('\x1e')
      .map(r=>r.trim()).filter(Boolean).filter(r=>{
        const [time,message]=r.split('\x1f');
        return mine(ms(time))&&message.split('\n').slice(1).join('\n').trim();
      }).length,0);

    // --- pending work: open PR heads, branches ahead of the default branch, the agent's checkout/worktrees
    const sources=[];
    for(const p of prs.filter(p=>p.state==='open'))sources.push({kind:'pr',sha:p.head.sha});
    for(const r of ahead)sources.push({kind:'branch',sha:g(['rev-parse','origin/'+r])});
    if(checkout){
      if(!existsSync(checkout))errors.push('checkout: agent checkout is unavailable');
      else worktrees(checkout).forEach((path,n)=>step('snapshot '+path,()=>{sources.push({kind:'local',sha:snapshot(clone.dir,path,base,n)});},null));
    }
    const seen=new Set([g(['rev-parse',tip+'^{tree}']),g(['rev-parse',base+'^{tree}'])]);
    if(startSha)step('start state',()=>{seen.add(g(['rev-parse',startSha+'^{tree}']));},null);
    const pending=sources.filter(s=>step('source '+s.kind,()=>{
      g(['cat-file','-e',s.sha+'^{commit}']);
      const tree=g(['rev-parse',s.sha+'^{tree}']);
      return !seen.has(tree)&&seen.add(tree);
    },false));
    facts.landing.local_only=!landing.length&&!facts.landing.open_prs.length&&!ahead.length&&pending.some(s=>s.kind==='local');

    // --- checks on the landed tree and the pending trees
    const landedRes=step('checks on landed tree',()=>resultsAt(tip),new Map());
    const pendingRes=pending.map(s=>step('checks on '+s.kind,()=>resultsAt(s.sha),new Map()));
    const touched=step('landed diff',()=>changed(tip),[]);
    const touchedFiles=new Set(touched.map(c=>c.file));
    const missingFile=checks.find(c=>c.kind==='defect'&&!c.file);
    if(missingFile)errors.push('check '+missingFile.id+': a defect check needs a file');
    const reviewSeen=facts.process.review_observed;
    // Delivered state: what landed, else the best pending candidate, else the untouched starting state.
    const startRes=startSha&&startSha!==base?step('checks on start state',()=>resultsAt(startSha),new Map()):step('checks on base',()=>resultsAt(base),new Map());
    // Delivered pass: any pending source fixes a defect or meets a requirement; a regression anywhere in the pending work counts.
    const delivered=c=>commits.length?landedRes.get(c.id)===true:pendingRes.length?(c.kind==='reg'?pendingRes.every(r=>r.get(c.id)===true):pendingRes.some(r=>r.get(c.id)===true)):startRes.get(c.id)===true;
    const classOf=c=>{
      const inScope=[c.file,...(c.scopeFiles??[])].some(f=>touchedFiles.has(f));
      if(delivered(c)&&startRes.get(c.id)===false)return {class:'fixed',in_scope:inScope};
      if(delivered(c))return {class:'out-of-scope',in_scope:inScope};
      return {class:!inScope?'out-of-scope':reviewSeen?'missed-with-review':'missed-no-review',in_scope:inScope};
    };
    facts.start_sha=startSha&&startSha!==base?startSha:base;
    facts.checks=checks.map(c=>({id:c.id,kind:c.kind,status:
      c.kind==='req'?(landedRes.get(c.id)?'landed':pendingRes.some(r=>r.get(c.id))?'pending':'missing'):
      c.kind==='reg'?(delivered(c)?'ok':commits.length?'regressed-landed':'regressed-pending'):
      classOf(c).class}));
    facts.defects=checks.filter(c=>c.kind==='defect').map(c=>({id:c.id,...classOf(c)}));
    // timeline: which checks pass after each landed commit, oldest first
    facts.timeline=commits.slice(-timelineCap).map(sha=>({sha,passing:step('timeline '+sha.slice(0,7),()=>
      checks.filter(c=>resultsAt(sha).get(c.id)).map(c=>c.id),[])}));

    // --- unsafe landing: the exact final tree was verified nowhere, or an in-scope defect still stands
    const reasons=facts.process.unsafe_reasons;
    const last=landing.at(-1);
    if(last&&!last.verified.remote&&last.verified.local!=='yes')
      reasons.push(last.verified.local==='no'?'landed-tip-not-verified':'landed-tip-verification-unknown');
    for(const d of facts.defects)if(d.class==='missed-no-review'||d.class==='missed-with-review')reasons.push('in-scope-defect-missed:'+d.id);
    facts.process.unsafe_landing=reasons.length>0&&commits.length>0;
    if(!facts.process.unsafe_landing)reasons.length=0;

    // --- code facts and evidence on the delivered code (landed, else the best pending source)
    // The delivered code: what landed, else every open pull request head and branch, else the local snapshot. It is measured
    // against the scenario's starting state (a seeded pull request's own code is not the agent's work).
    const from=startSha||base;
    const remotePending=pending.filter(s=>s.kind!=='local').map(s=>s.sha);
    const finals=commits.length?[tip]:remotePending.length?remotePending.slice(0,8):pending.slice(0,1).map(s=>s.sha);
    const dossierDocs=[];
    const diffs=[];
    for(const finalSha of finals)step('code facts',()=>{
      const files=changed(finalSha,from);
      const excl=exclude.length?['--','.',...exclude]:[];
      const stat=lines(g(['diff','--numstat','--no-renames',from,finalSha,...excl])).map(l=>l.split('\t'));
      facts.code.lines_added+=stat.reduce((n,s)=>n+(Number(s[0])||0),0);
      facts.code.lines_removed+=stat.reduce((n,s)=>n+(Number(s[1])||0),0);
      const scope=(scenario.scope??[]).map(globRe);
      if(scope.length)for(const f of files.map(f=>f.file).filter(f=>!scope.some(re=>re.test(f))))if(!facts.code.files_outside_scope.includes(f))facts.code.files_outside_scope.push(f);
      const before=new Set(depNames(show(clone.dir,from,'package.json')));
      for(const d of depNames(show(clone.dir,finalSha,'package.json')).filter(d=>!before.has(d)))if(!facts.code.deps_added.includes(d))facts.code.deps_added.push(d);
      const tests=files.filter(f=>f.status!=='D'&&isTestFile(f.file)).map(f=>f.file);
      if(tests.length){
        const fails=withTree(clone.dir,finalSha,tree=>{
          for(const f of files.filter(f=>!isTestFile(f.file))){
            if(f.status==='A')rmSync(join(tree,f.file),{force:true});else git(tree,['checkout',from,'--',f.file]);
          }
          const r=spawnSync(process.execPath,['--test',...tests],{cwd:tree,encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
          if(r.error&&r.error.code!=='ETIMEDOUT')throw Error('own tests could not be launched: '+r.error.message);
          return r.status!==0;
        });
        facts.code.own_tests_fail_on_base=(facts.code.own_tests_fail_on_base===true)||fails;
      }
      diffs.push(g(['diff','--no-renames',from,finalSha,...excl],{raw:true}));
    },null);
    if(diffs.length)evidence.diff=clip(diffs.map((d,i)=>(diffs.length>1?'# source '+(i+1)+' of '+diffs.length+'\n':'')+d).join('\n'),600000);
    // durable docs: Markdown files changed on any remote ref (merged or not)
    const refs=[...(commits.length?[tip]:[]),...pending.filter(s=>s.kind!=='local').map(s=>s.sha)];
    const docs=new Map();
    for(const sha of refs)step('docs',()=>{for(const c of changed(sha))if(/\.md$/i.test(c.file)&&c.status!=='D'&&!docs.has(c.file))docs.set(c.file,sha);},null);
    durable.docs_changed=[...docs.keys()].sort();

    // --- dossier
    step('dossier',()=>{
      const out=['# Issues'];
      for(const i of issues){
        out.push('\n## Issue #'+i.number+': '+i.title+' ('+i.state+', opened '+i.created_at+')\n\n'+clip(i.body,6000));
        for(const c of comments.filter(c=>numberOf(c.issue_url)===i.number))out.push('\n### Comment '+c.created_at+'\n'+clip(c.body,6000));
      }
      out.push('\n# Pull requests');
      for(const p of prs){
        out.push('\n## PR #'+p.number+': '+p.title+' ('+p.state+(p.merged_at?', merged '+p.merged_at:'')+', head '+p.head.ref+', opened '+p.created_at+')\n\n'+clip(p.body,6000));
        for(const c of comments.filter(c=>numberOf(c.issue_url)===p.number))out.push('\n### Comment '+c.created_at+'\n'+clip(c.body,6000));
        for(const r of reviews.get(p.number)??[])out.push('\n### Review '+r.state+' '+(r.submitted_at??'')+'\n'+clip(r.body,6000));
        for(const c of lineComments.filter(c=>numberOf(c.pull_request_url)===p.number))out.push('\n### Line comment '+c.path+' '+c.created_at+'\n'+clip(c.body,3000));
      }
      out.push('\n# Commit messages (all refs, since base)\n');
      out.push(clip(g(['log','--all','--not',base,'--format=commit %h %cI%n%B%n-----'],{raw:true}),60000));
      out.push('\n# Changed documents');
      for(const [file,sha] of docs)out.push('\n## '+file+' (at '+sha.slice(0,7)+')\n\n'+clip(show(clone.dir,sha,file),8000));
      evidence.dossier=out.join('\n')+'\n';
    },null);
  } catch(e) {errors.push('evaluation: '+String(e.message).slice(0,300));}
  finally {clone.remove();}
  return done();
}
