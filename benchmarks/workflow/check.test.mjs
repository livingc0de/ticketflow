import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkRuns, condense, localProgress, localVerification, ranOnRunner, runCheck, scoreCell } from './check.mjs';


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

test('a framework gate that started after merge is ignored; one that finished green after merge is flagged',()=>{
  const late=new Date(Date.parse(pr.mergedAt)+60_000).toISOString();
  const early=new Date(Date.parse(pr.mergedAt)-60_000).toISOString();
  const post=fixture([run(1)],{1:[job('tests'),job('Verify',{status:'in_progress',conclusion:null,completed_at:null,started_at:late})]});
  assert.equal(checkRuns('org/repo',pr,null,post.request).pass,true);
  const slow=fixture([run(1)],{1:[job('tests'),job('Verify',{started_at:early,completed_at:after})]});
  const result=checkRuns('org/repo',pr,null,slow.request);
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

test('checkRuns reads the latest job attempts, so a re-run that passed is not a failure',()=>{
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

test('ranOnRunner: only a runner or a step proves a job ran (GitHub sets started_at even on a refused job)',()=>{
  assert.equal(ranOnRunner({created_at:before,started_at:before,runner_id:0,runner_name:'',steps:[]}),false);
  assert.equal(ranOnRunner({runner_id:42}),true);
  assert.equal(ranOnRunner({steps:[{}]}),true);
});

// ---------------------------------------------------------------------------------------------------------------------
// condense, localVerification, runCheck
const jl=(...events)=>events.map(e=>JSON.stringify(e)).join('\n')+'\n';
const use=(id,name,input)=>({type:'assistant',message:{content:[{type:'tool_use',id,name,input}]}});
const fail=(id,text)=>({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,is_error:true,content:text}]}});

test('condense reads Claude stream-json: calls, errors, subagent spawns and permission denials',()=>{
  const out=condense(jl(
    {type:'system',subtype:'init'},
    use('a','Bash',{command:'npm test'}),
    fail('a','1 failing'),
    use('b','Edit',{file_path:'src/x.mjs'}),
    use('c','Task',{subagent_type:'reviewer',description:'review the change'}),
    {type:'result',permission_denials:[{tool_name:'Bash',tool_input:{command:'rm -rf x'}}]})+'not json at all\n');
  assert.deepEqual(out.calls.map(c=>[c.i,c.tool,c.cmd,c.file,Boolean(c.error)]),
    [[0,'Bash','npm test',null,true],[1,'Edit',null,'src/x.mjs',false],[2,'Task',null,null,false]]);
  assert.deepEqual(out.subagents,[{i:2,type:'reviewer',description:'review the change'}]);
  assert.deepEqual(out.permission_denials,[{tool:'Bash',command:'rm -rf x'}]);
});

test('condense reads Codex JSONL and reports no permission denials it cannot see',()=>{
  const out=condense(jl({type:'thread.started'},
    {type:'item.completed',item:{type:'command_execution',command:'npm test',exit_code:1}},
    {type:'item.completed',item:{type:'command_execution',command:'git push',exit_code:0}},
    {type:'item.completed',item:{type:'file_change',changes:[{path:'src/a.mjs',kind:'update'}]}},
    {type:'item.completed',item:{type:'agent_message',text:'done'}}));
  assert.deepEqual(out.calls.map(c=>[c.tool,c.cmd??c.file,c.error]),[['Bash','npm test','exit 1'],['Bash','git push',null],['Edit','src/a.mjs',null]]);
  assert.equal(out.permission_denials,null);
});

test('an unparsable transcript condenses to null',()=>{
  assert.equal(condense('garbage\n{"no":"type"}\n'),null);
  assert.equal(condense(''),null);
});

test('local verification means a passing test run after the last edit and before the last push',()=>{
  const c=(cmd,error=null,tool='Bash')=>({tool,cmd,error});
  const edit=(file)=>({tool:'Edit',cmd:null,error:null,file});
  assert.equal(localVerification([c('npm test'),c('git push origin main')]),true);
  assert.equal(localVerification([c('node --test test/a.test.mjs'),c('git -C x push -u origin feat')]),true);
  assert.equal(localVerification([c('npm test && git push')]),true);
  assert.equal(localVerification([c('git push && npm test')]),false);
  assert.equal(localVerification([c('npm test','1 failing'),c('git push')]),false);
  assert.equal(localVerification([c('git push'),c('npm test')]),false);
  assert.equal(localVerification([c('npm test')]),'unknown');
  // a test that predates the final edit does not vouch for what was pushed
  assert.equal(localVerification([edit('a.mjs'),c('npm test'),c('git push'),edit('a.mjs'),c('git commit -am fix'),c('git push')]),false);
  assert.equal(localVerification([edit('a.mjs'),c('npm test'),c('git push'),edit('a.mjs'),c('npm test'),c('git push')]),true);
  assert.equal(localVerification([c('npm test'),c("sed -i 's/a/b/' x"),c('git push')]),false);
  assert.equal(localVerification([edit('a.mjs'),c('npm test'),c('git commit -m x'),c('git push')]),true);   // committing is not editing
});

test('a check that times out is a fail; one that cannot be launched is an error',()=>{
  const dir=mkdtempSync(join(tmpdir(),'workflow-run-check-'));
  try{
    assert.equal(runCheck(dir,{id:'ok',code:'assert.equal(1,1)'}).pass,true);
    assert.equal(runCheck(dir,{id:'bad',code:'assert.equal(1,2)'}).pass,false);
    const slow=runCheck(dir,{id:'slow',code:'setInterval(()=>{},1000);await new Promise(()=>{})'});
    assert.equal(slow.pass,false);assert.match(slow.reason,/timed out/);
    writeFileSync(join(dir,'x.mjs'),'export const v=3');
    assert.equal(runCheck(dir,{id:'load',code:"assert.equal((await load('x.mjs')).v,3)"}).pass,true);
    assert.throws(()=>runCheck(join(dir,'missing'),{id:'x',code:''}),/could not be launched/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

// ---------------------------------------------------------------------------------------------------------------------
// End to end: a local bare origin plus a fake GitHub (`request`). Stub scenario, independent of scenarios.mjs.
const T0='2026-11-08T09:00:00Z',START='2026-11-08T10:00:00Z',SESSION=[{start:START,end:'2026-11-08T11:00:00Z'}];
const BASE={
  'package.json':'{"name":"app","type":"module","scripts":{"test":"node --test"}}\n',
  'src/export.mjs':"export function exportReport(rows,format){\n  if(format!=='tsv')throw Error('unknown format');\n  return rows.map(r=>r.join('\\t')).join('\\n');\n}\n",
  'src/summary.mjs':'export const count=(rows)=>rows.length+1;\n',
};
const CSV1="export function exportReport(rows,format){\n  if(format==='csv')return rows.map(r=>r.join(',')).join('\\n');\n  if(format!=='tsv')throw Error('unknown format');\n  return rows.map(r=>r.join('\\t')).join('\\n');\n}\n";
const CSV2="const q=v=>/[\",\\n]/.test(v)?'\"'+String(v).replace(/\"/g,'\"\"')+'\"':String(v);\nexport function exportReport(rows,format){\n  if(format==='csv')return rows.map(r=>r.map(q).join(',')).join('\\n');\n  if(format!=='tsv')throw Error('unknown format');\n  return rows.map(r=>r.join('\\t')).join('\\n');\n}\n";
const FIXED='export const count=(rows)=>rows.length;\n';
const OWN_TEST="import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {exportReport} from '../src/export.mjs';\ntest('csv',()=>assert.equal(exportReport([['a','b']],'csv'),'a,b'));\n";
const scenario={scope:['src/**','test/**'],checks:[
  {id:'R1',kind:'req',text:'csv rows are comma separated',source:'ticket',code:"assert.equal((await load('src/export.mjs')).exportReport([['a','b']],'csv'),'a,b')"},
  {id:'R2',kind:'req',text:'csv quotes commas',source:'ticket',code:"assert.equal((await load('src/export.mjs')).exportReport([['a,b','c']],'csv'),'\"a,b\",c')"},
  {id:'G1',kind:'reg',text:'tsv unchanged',source:'standard',code:"const m=await load('src/export.mjs');assert.equal(m.exportReport([['a','b']],'tsv'),'a\\tb');assert.throws(()=>m.exportReport([],'xml'))"},
  {id:'D1',kind:'defect',text:'count is exact',source:'code',file:'src/summary.mjs',code:"assert.equal((await load('src/summary.mjs')).count([1,2,3]),3)"},
  {id:'OLD',kind:'req',text:'replaced requirement',source:'ticket',supersededBy:'R1',code:'assert.fail()'},
]};
const sh=(cwd,args,date)=>execFileSync('git',args,{cwd,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@example.invalid',
  GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@example.invalid',...(date?{GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date}:{})}}).trim();
const put=(dir,files)=>{for(const [f,text] of Object.entries(files)){mkdirSync(dirname(join(dir,f)),{recursive:true});writeFileSync(join(dir,f),text);}};
const commit=(dir,message,date)=>{sh(dir,['add','-A']);sh(dir,['commit','-qm',message],date);return sh(dir,['rev-parse','HEAD']);};
const world=(root)=>{
  const origin=join(root,'origin.git'),work=join(root,'work');mkdirSync(work);
  sh(root,['init','-q','--bare','-b','main',origin]);sh(work,['init','-q','-b','main']);
  put(work,BASE);const base=commit(work,'Initial commit',T0);
  sh(work,['remote','add','origin',origin]);sh(work,['push','-q','origin','main']);
  return {origin,work,base};
};
/** Fake GitHub: `request` answers the REST paths the evaluator uses from plain data. */
const github=(d={})=>{
  const calls=[];
  const request=(path)=>{
    calls.push(path);
    const [p,q='']=path.replace(/^repos\/o\/r\//,'').split('?');
    const arr=(rows)=>/page=1(&|$)/.test(q)?rows:[];
    let m;
    if(p==='issues')return d.issues===undefined?arr([]):d.issues instanceof Error?(()=>{throw d.issues})():arr(d.issues);
    if(p==='pulls')return arr(d.pulls??[]);
    if(p==='issues/comments')return arr(d.comments??[]);
    if(p==='pulls/comments')return arr(d.lineComments??[]);
    if((m=p.match(/^pulls\/(\d+)\/reviews$/)))return arr(d.reviews?.[m[1]]??[]);
    if(p==='activity'){if(d.activity===null)throw Error('activity unavailable');return arr(d.activity??[]);}
    if((m=p.match(/^commits\/(\w+)\/pulls$/)))return arr((d.pulls??[]).filter(x=>x.merge_commit_sha===m[1]));
    if((m=p.match(/^commits\/(\w+)\/status$/)))return {sha:m[1],statuses:d.statuses?.[m[1]]??[]};
    if(p==='actions/runs'){
      const sha=/head_sha=(\w+)/.exec(q)?.[1],runs=sha?(d.runs??[]).filter(r=>r.head_sha===sha):[];
      return {total_count:runs.length,workflow_runs:runs.map(({jobs,...r})=>r)};
    }
    if((m=p.match(/^actions\/runs\/(\d+)\/jobs$/))){const jobs=d.runs.find(r=>r.id===Number(m[1])).jobs;return {total_count:jobs.length,jobs};}
    throw Error('unexpected request '+path);
  };
  return {calls,request};
};
const prRow=(n,head,over={})=>({number:n,state:'open',merged_at:null,merge_commit_sha:null,title:'Add CSV',body:'Adds a CSV option.',
  created_at:'2026-11-08T10:20:00Z',head:{sha:head,ref:'feature'},base:{ref:'main'},...over});
const score=(w,gh,extra={})=>scoreCell({repo:'o/r',remote:w.origin,request:gh.request,scenario,base:w.base,sessions:SESSION,
  seeded:{issues:[1],pr:null,commentId:null},...extra});
const inRoot=(fn)=>{const root=mkdtempSync(join(tmpdir(),'workflow-score-')),r=fn(root);return r instanceof Promise?r.finally(()=>rmSync(root,{recursive:true,force:true})):(rmSync(root,{recursive:true,force:true}),r);};
const status=(facts)=>Object.fromEntries(facts.checks.map(c=>[c.id,c.status]));

test('direct push of the reference: landed, defect fixed, verified, timeline grows commit by commit, own tests bite',()=>inRoot(root=>{
  const w=world(root);
  put(w.work,{'src/export.mjs':CSV1});const c1=commit(w.work,'csv basics','2026-11-08T10:30:00Z');
  put(w.work,{'src/export.mjs':CSV2,'src/summary.mjs':FIXED,'test/export.test.mjs':OWN_TEST});
  const c2=commit(w.work,'csv quoting\n\nQuotes commas, quotes and newlines.','2026-11-08T10:31:00Z');
  sh(w.work,['push','-q','origin','main']);
  const gh=github({issues:[{number:1,title:'CSV please',body:'x',state:'open',created_at:'2026-11-08T08:00:00Z'}],
    statuses:{[c2]:[{state:'success',context:'ci',updated_at:'2026-11-08T10:31:30Z'}]},
    activity:[{after:w.base,timestamp:'2026-11-08T09:00:00Z',activity_type:'push'},{after:c2,timestamp:'2026-11-08T10:32:00Z',activity_type:'push'}]});
  const facts=score(w,gh);
  assert.deepEqual(facts.errors,[]);
  assert.equal(facts.landed_sha,c2);
  assert.equal(facts.landing.mode,'direct');
  assert.equal(facts.landing.timing,'known');
  assert.equal(facts.landing.force_pushes,0);
  assert.deepEqual(facts.landing.commits.map(c=>[c.sha,c.via,c.pr,c.time]),
    [[c1,'direct',null,'2026-11-08T10:32:00.000Z'],[c2,'direct',null,'2026-11-08T10:32:00.000Z']]);
  assert.deepEqual(facts.landing.commits.map(c=>c.verified),[{remote:false,local:'unknown'},{remote:true,local:'unknown'}]);
  assert.deepEqual(status(facts),{R1:'landed',R2:'landed',G1:'ok',D1:'fixed'});   // the superseded check is gone
  assert.deepEqual(facts.defects,[{id:'D1',class:'fixed',in_scope:true}]);
  assert.deepEqual(facts.timeline,[{sha:c1,passing:['R1','G1']},{sha:c2,passing:['R1','R2','G1','D1']}]);
  assert.equal(facts.process.unsafe_landing,false);
  assert.equal(facts.process.review_observed,false);
  assert.equal(facts.process.review_before_landing,false);
  assert.deepEqual(facts.process.durable_record,{issues:0,issue_comments:0,pr_bodies:0,docs_changed:[],commit_bodies:1});
  assert.equal(facts.code.own_tests_fail_on_base,true);
  assert.deepEqual(facts.code.files_outside_scope,[]);
  assert.deepEqual(facts.landing.open_prs,[]);
  assert.equal(facts.landing.local_only,false);
}));

test('a branch merged through a PR with a tree-identical verified head is a verified PR landing with a review before the merge',()=>inRoot(root=>{
  const w=world(root);
  sh(w.work,['checkout','-q','-b','feature']);
  put(w.work,{'src/export.mjs':CSV2,'src/summary.mjs':FIXED,'README.md':'# notes\n'});
  const head=commit(w.work,'csv','2026-11-08T10:30:00Z');
  sh(w.work,['push','-q','origin','feature:refs/pull/1/head']);
  sh(w.work,['checkout','-q','main']);sh(w.work,['checkout','feature','--','.']);
  const merged=commit(w.work,'Add CSV (#1)','2026-11-08T10:40:00Z');
  sh(w.work,['push','-q','origin','main']);
  const pr=prRow(1,head,{state:'closed',merged_at:'2026-11-08T10:40:00Z',merge_commit_sha:merged});
  const gh=github({pulls:[pr],activity:[{after:merged,timestamp:'2026-11-08T10:40:00Z',activity_type:'pr_merge'}],
    reviews:{1:[{id:5,state:'COMMENTED',body:'Checked quoting and the summary count.',submitted_at:'2026-11-08T10:36:00Z'}]},
    runs:[{id:1,head_sha:head,name:'ci',status:'completed',conclusion:'success',updated_at:'2026-11-08T10:35:00Z',
      jobs:[{head_sha:head,name:'tests',status:'completed',conclusion:'success',completed_at:'2026-11-08T10:35:00Z'}]}]});
  const facts=score(w,gh);
  assert.deepEqual(facts.errors,[]);
  assert.equal(facts.landing.mode,'pr');
  assert.deepEqual(facts.landing.commits,[{sha:merged,via:'pr',pr:1,time:'2026-11-08T10:40:00.000Z',verified:{remote:true,local:'unknown'}}]);
  assert.equal(facts.process.review_observed,true);
  assert.equal(facts.process.review_before_landing,true);
  assert.equal(facts.process.unsafe_landing,false);
  assert.deepEqual(facts.process.durable_record.docs_changed,['README.md']);
  assert.deepEqual(facts.code.files_outside_scope,['README.md']);
  assert.equal(facts.process.durable_record.pr_bodies,1);
  assert.deepEqual(status(facts),{R1:'landed',R2:'landed',G1:'ok',D1:'fixed'});
  assert.deepEqual(facts.landing.ahead_branches,[]);   // the merged PR head is not pending work
}));

test('a squash merge whose tree differs from the tested PR head is not verified; the agent can still vouch locally',()=>inRoot(root=>{
  const w=world(root);
  put(w.work,{'docs/other.txt':'unrelated\n'});commit(w.work,'unrelated change','2026-11-08T10:10:00Z');
  sh(w.work,['push','-q','origin','main']);
  sh(w.work,['checkout','-q','-b','feature',w.base]);
  put(w.work,{'src/export.mjs':CSV2,'src/summary.mjs':FIXED});
  const head=commit(w.work,'csv','2026-11-08T10:30:00Z');
  sh(w.work,['push','-q','origin','feature:refs/pull/1/head']);
  sh(w.work,['checkout','-q','main']);sh(w.work,['checkout','feature','--','src']);
  const merged=commit(w.work,'Add CSV (#1)','2026-11-08T10:40:00Z');
  sh(w.work,['push','-q','origin','main']);
  const data={pulls:[prRow(1,head,{state:'closed',merged_at:'2026-11-08T10:40:00Z',merge_commit_sha:merged})],
    activity:[{after:merged,timestamp:'2026-11-08T10:40:00Z',activity_type:'pr_merge'}],
    runs:[{id:1,head_sha:head,name:'ci',status:'completed',conclusion:'success',updated_at:'2026-11-08T10:35:00Z',
      jobs:[{head_sha:head,name:'tests',status:'completed',conclusion:'success',completed_at:'2026-11-08T10:35:00Z'}]}]};
  const facts=score(w,github(data));
  assert.deepEqual(facts.errors,[]);
  assert.equal(facts.landing.commits[0].verified.remote,false);
  assert.equal(facts.process.unsafe_landing,true);
  assert.deepEqual(facts.process.unsafe_reasons,['landed-tip-verification-unknown']);
  assert.equal(facts.process.review_before_landing,false);
  const transcript=jl(use('a','Bash',{command:'npm test'}),use('b','Bash',{command:'git push origin feature'}));
  const vouched=score(w,github(data),{transcripts:[transcript]});
  assert.equal(vouched.landing.commits[0].verified.local,'yes');
  assert.equal(vouched.process.unsafe_landing,false);
  assert.deepEqual(vouched.transcript,{tool_calls:2,subagents:0,permission_denials:null,local_verification_before_push:true});
  const failed=score(w,github(data),{transcripts:[jl(use('b','Bash',{command:'git push origin feature'}))]});
  assert.deepEqual(failed.process.unsafe_reasons,['landed-tip-not-verified']);
}));

test('an open PR only: nothing landed, the work is pending, the defect is out of scope',()=>inRoot(root=>{
  const w=world(root);
  sh(w.work,['checkout','-q','-b','feature']);
  put(w.work,{'src/export.mjs':CSV2});
  const head=commit(w.work,'csv','2026-11-08T10:30:00Z');
  sh(w.work,['push','-q','origin','feature:refs/pull/1/head']);
  sh(w.work,['push','-q','origin','feature']);
  const gh=github({pulls:[prRow(1,head)],activity:[]});
  const facts=score(w,gh);
  assert.deepEqual(facts.errors,[]);
  assert.equal(facts.landed_sha,null);
  assert.equal(facts.landing.mode,'none');
  assert.deepEqual(facts.landing.open_prs,[1]);
  assert.deepEqual(facts.landing.ahead_branches,['feature']);
  assert.equal(facts.landing.local_only,false);
  assert.deepEqual(status(facts),{R1:'pending',R2:'pending',G1:'ok',D1:'out-of-scope'});
  assert.deepEqual(facts.defects,[{id:'D1',class:'out-of-scope',in_scope:false}]);
  assert.equal(facts.process.unsafe_landing,false);
  assert.deepEqual(facts.timeline,[]);
  assert.equal(facts.code.lines_added>0,true);   // code facts describe the pending PR head
}));

test('a seeded start state that is broken while the default branch is fine: untouched stays unfixed, a pending fix counts as fixed',()=>inRoot(root=>{
  const origin=join(root,'origin.git'),work=join(root,'work');mkdirSync(work);
  sh(root,['init','-q','--bare','-b','main',origin]);sh(work,['init','-q','-b','main']);
  put(work,{...BASE,'src/summary.mjs':FIXED});const base=commit(work,'Initial commit',T0);
  sh(work,['remote','add','origin',origin]);sh(work,['push','-q','origin','main']);
  sh(work,['checkout','-q','-b','feature']);
  put(work,{'src/summary.mjs':BASE['src/summary.mjs']});          // the seeded PR breaks what main has right
  const startSha=commit(work,'seeded PR','2026-11-08T09:30:00Z');
  sh(work,['push','-q','origin','feature:refs/pull/1/head']);sh(work,['push','-q','origin','feature']);
  const only={...scenario,checks:scenario.checks.filter(c=>c.id==='D1')};
  const run=(head)=>scoreCell({repo:'o/r',remote:origin,request:github({pulls:[prRow(1,head)],activity:[]}).request,scenario:only,base,startSha,
    sessions:SESSION,seeded:{issues:[],pr:1,commentId:null}});
  const untouched=run(startSha);
  assert.deepEqual(untouched.errors,[]);
  assert.equal(untouched.defects[0].class,'out-of-scope');          // not "fixed" just because main passes
  put(work,{'src/summary.mjs':FIXED,'src/batch.mjs':'export const batch=1;\n'});   // a real fix also carries the new work
  const fixedHead=commit(work,'fix','2026-11-08T10:30:00Z');
  sh(work,['push','-q','origin','feature:refs/pull/1/head']);sh(work,['push','-q','origin','feature']);
  const fixed=run(fixedHead);
  assert.deepEqual(fixed.errors,[]);
  assert.equal(fixed.defects[0].class,'fixed');
  assert.equal(fixed.start_sha,startSha);
}));

test('an untouched seeded pull request is not the agent\'s work: nothing pending, no code facts, nothing delivered',()=>inRoot(root=>{
  const origin=join(root,'origin.git'),work=join(root,'work');mkdirSync(work);
  sh(root,['init','-q','--bare','-b','main',origin]);sh(work,['init','-q','-b','main']);
  put(work,BASE);const base=commit(work,'Initial commit',T0);
  sh(work,['remote','add','origin',origin]);sh(work,['push','-q','origin','main']);
  sh(work,['checkout','-q','-b','feature']);
  put(work,{'src/export.mjs':CSV1,'test/seed.test.mjs':OWN_TEST});     // the seeded pull request: partial CSV and a test
  const startSha=commit(work,'seeded PR','2026-11-08T09:30:00Z');
  sh(work,['push','-q','origin','feature:refs/pull/1/head']);sh(work,['push','-q','origin','feature']);
  const facts=scoreCell({repo:'o/r',remote:origin,request:github({pulls:[prRow(1,startSha)],activity:[]}).request,scenario,base,startSha,
    sessions:SESSION,seeded:{issues:[],pr:1,commentId:null}});
  assert.deepEqual(facts.errors,[]);
  assert.equal(facts.code.lines_added,0);
  assert.equal(facts.code.lines_removed,0);
  assert.equal(facts.code.own_tests_fail_on_base,null);       // the seeded test is not the agent's test
  assert.equal(status(facts).R1,'missing');                    // passing at the seed is not delivered by the agent
  assert.equal(facts.landing.mode,'none');
}));

test('every open pull request is scored: requirements, defects, code facts and the diff cover them all',()=>inRoot(root=>{
  const w=world(root);
  sh(w.work,['checkout','-q','-b','one']);put(w.work,{'src/export.mjs':CSV2});
  const h1=commit(w.work,'csv','2026-11-08T10:30:00Z');
  sh(w.work,['push','-q','origin','one:refs/pull/1/head']);sh(w.work,['push','-q','origin','one']);
  sh(w.work,['checkout','-q','main']);sh(w.work,['checkout','-q','-b','two']);put(w.work,{'src/summary.mjs':FIXED});
  const h2=commit(w.work,'count','2026-11-08T10:40:00Z');
  sh(w.work,['push','-q','origin','two:refs/pull/2/head']);sh(w.work,['push','-q','origin','two']);
  const facts=score(w,github({pulls:[prRow(1,h1),prRow(2,h2,{head:{sha:h2,ref:'two'}})],activity:[]}));
  assert.deepEqual(facts.errors,[]);
  const st=status(facts);
  assert.deepEqual([st.R1,st.R2,st.D1],['pending','pending','fixed']);
  assert.equal(facts.code.lines_added>=2,true);
  const evidence=join(root,'evidence');
  scoreCell({repo:'o/r',remote:w.origin,request:github({pulls:[prRow(1,h1),prRow(2,h2,{head:{sha:h2,ref:'two'}})],activity:[]}).request,scenario,base:w.base,sessions:SESSION,
    seeded:{issues:[],pr:null,commentId:null},evidenceDir:evidence});
  const diff=readFileSync(join(evidence,'diff.patch'),'utf8');
  assert.match(diff,/src\/export\.mjs/);assert.match(diff,/src\/summary\.mjs/);
}));

test('uncommitted work in the agent checkout is pending and local only; localProgress sees it',()=>inRoot(root=>{
  const w=world(root),agent=join(root,'agent');
  sh(root,['clone','-q',w.origin,agent]);
  assert.deepEqual(localProgress(agent,w.base),{progressed:false,commits:0,dirty:false,files:[]});
  put(agent,{'NOTES.md':'notes\n'});
  assert.equal(localProgress(agent,w.base).progressed,false);   // docs do not count as product progress
  put(agent,{'src/export.mjs':CSV2,'test/new.test.mjs':OWN_TEST});
  const progress=localProgress(agent,w.base);
  assert.equal(progress.progressed,true);assert.equal(progress.dirty,true);assert.equal(progress.commits,0);
  assert.deepEqual(progress.files.sort(),['src/export.mjs','test/new.test.mjs']);
  const facts=score(w,github({}),{checkout:agent});
  assert.deepEqual(facts.errors,[]);
  assert.equal(facts.landing.mode,'none');
  assert.equal(facts.landing.local_only,true);
  assert.deepEqual(status(facts),{R1:'pending',R2:'pending',G1:'ok',D1:'out-of-scope'});
  assert.equal(facts.code.own_tests_fail_on_base,true);
  // committed but not pushed counts as progress too
  commit(agent,'wip','2026-11-08T10:30:00Z');
  const committed=localProgress(agent,w.base);
  assert.deepEqual([committed.commits,committed.dirty],[1,false]);
  // a checkout that was removed is an evaluation problem, not an agent failure
  assert.match(score(w,github({}),{checkout:join(root,'gone')}).errors[0],/agent checkout is unavailable/);
}));

test('partial landing: one requirement missing and an in-scope defect left alone, with and without a review',()=>inRoot(root=>{
  const w=world(root);
  put(w.work,{'src/export.mjs':CSV1,'src/summary.mjs':'export const count=(rows)=>rows.length+1; // tidy\n'});
  const c1=commit(w.work,'csv','2026-11-08T10:30:00Z');
  sh(w.work,['push','-q','origin','main']);
  const data={activity:[{after:c1,timestamp:'2026-11-08T10:31:00Z',activity_type:'push'}]};
  const facts=score(w,github(data));
  assert.deepEqual(facts.errors,[]);
  assert.deepEqual(status(facts),{R1:'landed',R2:'missing',G1:'ok',D1:'missed-no-review'});
  assert.deepEqual(facts.defects,[{id:'D1',class:'missed-no-review',in_scope:true}]);
  assert.equal(facts.process.unsafe_landing,true);
  assert.deepEqual(facts.process.unsafe_reasons,['landed-tip-verification-unknown','in-scope-defect-missed:D1']);
  assert.deepEqual(facts.timeline,[{sha:c1,passing:['R1','G1']}]);
  const reviewed=score(w,github({...data,pulls:[prRow(2,c1,{state:'closed',merge_commit_sha:null})],
    reviews:{2:[{id:9,state:'CHANGES_REQUESTED',body:'',submitted_at:'2026-11-08T10:20:00Z'}]}}));
  assert.equal(reviewed.process.review_observed,true);
  assert.equal(reviewed.defects[0].class,'missed-with-review');
  assert.equal(reviewed.process.review_before_landing,false);   // the landed commit has no PR carrying a review
}));

test('seeded items are excluded by ID and agent activity is detected by timestamp, not author',()=>inRoot(root=>{
  const w=world(root);
  const gh=github({
    issues:[{number:1,title:'seeded',body:'b',state:'open',created_at:'2026-11-08T08:00:00Z'},
      {number:2,title:'agent ticket',body:'b',state:'open',created_at:'2026-11-08T10:05:00Z'},
      {number:3,title:'a PR as an issue',pull_request:{},body:'b',state:'open',created_at:'2026-11-08T10:06:00Z'}],
    pulls:[prRow(3,w.base,{created_at:'2026-11-08T10:06:00Z'}),prRow(4,w.base,{created_at:'2026-11-08T08:30:00Z',body:'seeded body'})],
    comments:[{id:50,issue_url:'https://api/x/issues/4',created_at:'2026-11-08T08:40:00Z',body:'seeded finding, long enough to look like a review comment'},
      {id:51,issue_url:'https://api/x/issues/1',created_at:'2026-11-08T10:10:00Z',body:'agent note'},
      {id:52,issue_url:'https://api/x/issues/4',created_at:'2026-11-08T10:12:00Z',body:'short'}]});
  const facts=score(w,gh,{seeded:{issues:[1],pr:4,commentId:50}});
  assert.deepEqual(facts.errors,[]);
  assert.deepEqual(facts.process.durable_record,{issues:1,issue_comments:2,pr_bodies:1,docs_changed:[],commit_bodies:0});
  assert.equal(facts.process.review_observed,false);   // the seeded comment and a trivial note are not a review
  const noSeedId=score(w,github({pulls:[prRow(4,w.base)],
    comments:[{id:50,issue_url:'https://api/x/issues/4',created_at:'2026-11-08T08:40:00Z',body:'x'.repeat(60)}]}),{seeded:{issues:[],pr:4,commentId:null}});
  assert.equal(noSeedId.process.review_observed,false);   // before the session start, so not agent activity either
}));

test('an unavailable activity API makes timing unknown but never invalidates; other malformed listings do',()=>inRoot(root=>{
  const w=world(root);
  put(w.work,{'src/export.mjs':CSV1});const c1=commit(w.work,'csv','2026-11-08T10:30:00Z');sh(w.work,['push','-q','origin','main']);
  const facts=score(w,github({activity:null,statuses:{[c1]:[{state:'success',updated_at:'2026-11-08T10:31:00Z'}]}}));
  assert.deepEqual(facts.errors,[]);
  assert.equal(facts.landing.timing,'unknown');
  assert.equal(facts.landing.force_pushes,'unknown');
  assert.equal(facts.landing.commits[0].time,null);
  assert.equal(facts.landing.commits[0].verified.remote,false);   // without a landing time nothing counts as verified before it
  const broken=score(w,github({issues:new Error('HTTP 502')}));
  assert.match(broken.errors.join('\n'),/issues: HTTP 502/);
  const malformed=github({pulls:[{number:'x'}]});
  assert.match(score(w,malformed).errors.join('\n'),/pulls: .*malformed/);
  const incomplete=score(w,{request:()=>Array.from({length:100},(_,i)=>({number:i+1,created_at:'2026-11-08T10:00:00Z'}))});
  assert.match(incomplete.errors.join('\n'),/incomplete|malformed/);
}));

test('a check that cannot be launched, a missing base or remote, and a defect check without a file are errors',()=>inRoot(root=>{
  const w=world(root);
  const boom=()=>{throw Error('check x could not be launched');};
  assert.match(score(w,github({}),{runCheck:boom}).errors.join('\n'),/could not be launched/);
  assert.match(score(w,github({}),{base:'1'.repeat(40)}).errors.join('\n'),/base\/tip/);
  assert.match(score(w,github({}),{remote:join(root,'nowhere.git')}).errors.join('\n'),/clone:/);
  const noFile={...scenario,checks:[{id:'D9',kind:'defect',text:'t',source:'code',code:''}]};
  assert.match(score(w,github({}),{scenario:noFile,runCheck:()=>true}).errors.join('\n'),/needs a file/);
  assert.throws(()=>score(w,github({}),{sessions:[]}),/sessions\[0\]\.start/);
  assert.throws(()=>score(w,github({}),{scenario:{checks:[{id:'a',kind:'odd'}]}}),/unknown kind/);
}));

test('the evidence bundle holds facts, the code-only diff, the dossier, the condensed transcript, answers and checks',()=>inRoot(root=>{
  const w=world(root),dir=join(root,'evidence');
  put(w.work,{'.ticketflow/config.json':'{}\n'});const install=commit(w.work,'install','2026-11-08T09:30:00Z');
  sh(w.work,['push','-q','origin','main']);
  put(w.work,{'src/export.mjs':CSV2,'docs/notes.md':'# Why\nBecause.\n','.ticketflow/config.json':'{"x":1}\n'});
  const c1=commit(w.work,'csv\n\nExplains the quoting rule.','2026-11-08T10:30:00Z');
  sh(w.work,['push','-q','origin','main']);
  const gh=github({issues:[{number:1,title:'CSV please',body:'we need csv',state:'open',created_at:'2026-11-08T08:00:00Z'}],
    activity:[{after:c1,timestamp:'2026-11-08T10:31:00Z',activity_type:'push'}]});
  const facts=score({...w,base:install},gh,{evidenceDir:dir,installSha:install,answers:['All done.','Fixed the rest.'],
    transcripts:[jl(use('a','Bash',{command:'ls'}))]});
  assert.deepEqual(facts.errors,[]);
  const read=f=>readFileSync(join(dir,f),'utf8');
  assert.deepEqual(JSON.parse(read('facts.json')),facts);
  assert.match(read('diff.patch'),/diff --git a\/src\/export\.mjs/);
  assert.doesNotMatch(read('diff.patch'),/\.ticketflow/);   // install files stay out of the code diff
  assert.match(read('dossier.md'),/Issue #1: CSV please[\s\S]*Explains the quoting rule[\s\S]*docs\/notes\.md[\s\S]*Because\./);
  assert.deepEqual(JSON.parse(read('transcript.json')).calls.map(c=>c.cmd),['ls']);
  assert.match(read('answers.txt'),/--- session 1 ---\nAll done\.\n[\s\S]*--- session 2 ---\nFixed the rest\./);
  const checks=JSON.parse(read('checks.json'));
  assert.deepEqual(checks.map(c=>c.id),['R1','R2','G1','D1']);
  assert.deepEqual(Object.keys(checks[3]).sort(),['file','id','kind','source','text']);   // never the check code
  assert.deepEqual(facts.process.durable_record.docs_changed,['docs/notes.md']);
  const unparsable=score({...w,base:install},gh,{evidenceDir:join(root,'e2'),transcripts:['garbage']});
  assert.deepEqual(unparsable.transcript,{tool_calls:null,subagents:null,permission_denials:null,local_verification_before_push:null});
  assert.equal(JSON.parse(readFileSync(join(root,'e2','transcript.json'),'utf8')).unparsable,true);
}));
