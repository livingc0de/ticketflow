import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {scenarios,ids,fixture,prompt,fillIssue} from './scenarios.mjs';
import {reference} from './reference.mjs';
import {cfg,MODELS,seedIssues,seedPR,setupEnv,ancestorGuidance,newWork} from './sandbox.mjs';
import {validate} from '../../core/lib/config.mjs';

const seededCtx=(id)=>({issues:scenarios[id].issues.map((_,i)=>100+i+1),pr:scenarios[id].seedPR?200:null});
/** Process wording a person would not use when asking for work. */
const PROCESS=/\b(review\w*|merg\w*|project\w*|board\w*|verif\w*|report\w*|plans?|branch\w*|commit\w*|ci|pull request|benchmark\w*)\b/i;
const PROCESS_NO_PLAN=/\b(review\w*|merg\w*|project\w*|board\w*|verif\w*|report\w*|branch\w*|commit\w*|ci|pull request|benchmark\w*)\b/i;
const LABELS=/\bW[1-7]\b|ticketflow|superpowers|ponytail|\bbare\b|workflow[- ]bench|benchmark|\barm\b/i;
const visibleText=(id)=>{
  const s=scenarios[id];
  return [...s.sessions.map(x=>x.prompt),...s.issues.flatMap(i=>[i.title,i.body]),
    ...(s.seedPR?[s.seedPR.title,s.seedPR.body,s.seedPR.comment,s.seedPR.commitMessage]:[])];
};

test('seven scenarios with the intended starting state',()=>{
  assert.deepEqual(ids,['W1','W2','W3','W4','W5','W6','W7']);
  assert.deepEqual(ids.map(id=>scenarios[id].issues.length),[0,1,3,0,1,0,7]);
  assert.deepEqual(ids.map(id=>scenarios[id].size),['one','one','few','one','one','many','many']);
  assert.deepEqual(ids.map(id=>scenarios[id].sessions.length),[1,1,1,1,2,1,2]);
  assert.deepEqual(ids.filter(id=>scenarios[id].sessions.some(s=>s.interrupt)),['W5']);
  assert.equal(scenarios.W5.sessions[0].interrupt,true);
  assert.deepEqual(ids.filter(id=>scenarios[id].seedPR),['W4']);
  for(const id of ids) {
    const s=scenarios[id];
    assert.ok(s.title&&s.timeoutMin>0&&Array.isArray(s.scope)&&s.scope.length);
    for(const i of s.issues) assert.ok(i.title&&i.body);
    assert.equal(s.timeoutMin,s.sessions.reduce((n,x)=>n+x.timeoutMin,0),id+' total cap is the sum of session caps');
  }
});
test('prompts, tickets and PR text read like a person wrote them and carry no process wording',()=>{
  for(const id of ids) for(const text of visibleText(id)) {
    assert.doesNotMatch(text,PROCESS,id+': '+text);
    assert.doesNotMatch(text,LABELS,id+': '+text);
  }
  for(const id of ids) for(let i=0;i<scenarios[id].sessions.length;i++) {
    const p=prompt(id,seededCtx(id),i);
    assert.ok(!/[{}]/.test(p),p);
    assert.ok(p.length<120,'prompts are short: '+p);
  }
});
test('the repository itself shows no scenario id, tool name or process wording in its files',()=>{
  for(const id of ids) for(const [path,content] of Object.entries(fixture(id,{withPR:true}))) {
    assert.doesNotMatch(path+'\n'+content,LABELS,id+' '+path);
    if(path==='README.md') assert.doesNotMatch(content,PROCESS_NO_PLAN,id+' '+path);
  }
  assert.equal(JSON.parse(fixture('W1')['package.json']).name,'service');
  assert.doesNotMatch(fixture('W1')['.github/workflows/test.yml'],LABELS);
});
test('prompt() fills seeded numbers and fails loudly without them',()=>{
  assert.equal(prompt('W2',{issues:[7]}),'Can you take a look at issue #7?');
  assert.equal(prompt('W5',{issues:[3]},0),'Can you pick up issue #3?');
  assert.equal(prompt('W5',{issues:[3]},1),'Continue where we left off.');
  assert.equal(prompt('W4',{pr:9}),'PR #9 is red and has a comment on it, can you sort it out?');
  assert.equal(prompt('W1'),'Could you add a CSV option next to the TSV export? It\'s exportReport in src/export.mjs.');
  assert.throws(()=>prompt('W4',{}),/no seeded pull request/);
  assert.throws(()=>prompt('W2',{}),/no seeded issue/);
  assert.throws(()=>prompt('W2',{issues:[1]},3),/no session/);
  assert.throws(()=>prompt('W9'),/unknown scenario/);
  assert.match(fillIssue(scenarios.W3.issues[2].body,{issues:[11,12]}),/After #11 and #12/);
});
test('checks are well formed, sourced, and run through entry points that exist or are named for the agent',()=>{
  for(const id of ids) {
    const s=scenarios[id],files=fixture(id,{withPR:true});
    const named=[readme(files),...visibleText(id)].join('\n');
    const seen=new Set();
    assert.ok(s.checks.some(c=>c.kind==='req'),id);
    for(const c of s.checks) {
      assert.ok(!seen.has(c.id),'duplicate check id '+c.id);seen.add(c.id);
      assert.ok(['req','reg','defect'].includes(c.kind),c.id);
      assert.ok(['ticket','brief','code','standard'].includes(c.source),id+'/'+c.id);
      assert.ok(c.text&&c.code,c.id);
      assert.ok(!c.supersededBy||s.checks.some(x=>x.id===c.supersededBy&&x.kind==='req'),c.id);
      assert.doesNotThrow(()=>new Function('return (async()=>{'+c.code+'})'),c.id);
      assert.ok(c.file,id+'/'+c.id+' names its entry file');
      if(c.source==='ticket') assert.ok(s.issues.length||s.sessions.length>1,id+'/'+c.id);
      if(c.source==='brief') assert.ok(files['README.md'],id+'/'+c.id);
      assert.ok(files[c.file]||named.includes(c.file),id+'/'+c.id+': '+c.file+' is neither in the repository nor named for the agent');
      for(const m of c.code.matchAll(/const \{([^}]*)\}\s*=\s*await load\('([^']+)'\)/g)) {
        const [,names,path]=m;
        assert.ok(files[path]||named.includes(path),id+'/'+c.id+' loads '+path);
        for(const name of names.split(',').map(n=>n.trim())) {
          const exported=files[path]&&new RegExp('export (?:async )?(?:function|const) '+name+'\\b').test(files[path]);
          assert.ok(exported||new RegExp('\\b'+name+'\\b').test(named),id+'/'+c.id+': '+name+' is neither exported by the fixture nor named for the agent');
        }
      }
    }
    for(const c of s.checks.filter(c=>c.kind==='defect')) {
      // latent: the defect and its fix location are never named for the agent
      assert.ok(files[c.file]||reference(id)[c.file],id+'/'+c.id);
    }
  }
});
const readme=(files)=>files['README.md']??'';
test('planted defects are latent: not mentioned in any ticket, prompt, PR text or brief',()=>{
  const hints={W2:/settle|settlement|vat/i,W3:/summary|orderSummary/i,W4:/reverse/i,W5:/in place|mutat|reorder|sort/i,W6:/prefix|findPlan|startsWith|basic-old/i,W7:/renderLink|tenantPage|tenant-pages|link/i};
  for(const [id,re] of Object.entries(hints)) {
    const text=[...visibleText(id),readme(fixture(id))].join('\n');
    assert.doesNotMatch(text,re,id);
  }
});
test('fixtures are self-contained: neutral CI file, tests present, no hidden material',()=>{
  for(const id of ids) {
    const f=fixture(id);
    assert.ok(f['package.json']&&f['.github/workflows/test.yml']);
    assert.match(f['.github/workflows/test.yml'],/tests:/);
    assert.ok(Object.keys(f).some(p=>/^test\/.*\.test\.mjs$/.test(p)),id);
    assert.ok(Object.keys(f).filter(p=>p.startsWith('src/')).length>=2,id+' has several modules');
    assert.ok(!Object.keys(f).some(p=>/hidden|cases\.json|check/i.test(p)));
  }
  assert.ok(scenarios.W6.sessions.length===1&&(fixture('W6')['README.md'].match(/^- /gm)??[]).length>=18,'W6 brief has bullets and an API list');
  assert.equal((fixture('W6')['README.md'].split('## Rough API')[0].match(/^- /gm)??[]).length,11);
});
test('TicketFlow config supplied to the fixture is valid without requiring competitors to use it',()=>{
  assert.doesNotThrow(()=>validate(cfg('bench/repo','bench',3,'claude')));
  assert.doesNotThrow(()=>validate(cfg('bench/repo','bench',3,'codex')));
});
test('the fixture config maps the model classes to real models: the template aliases for Claude, full ids for Codex',()=>{
  const template=JSON.parse(readFileSync(new URL('../../core/templates/config.json',import.meta.url),'utf8')).models;
  assert.deepEqual(MODELS.claude,template.claude,'claude differs from core/templates/config.json');
  for(const c of ['strong','standard','light']) assert.match(MODELS.codex[c],/^gpt-5\.6-[a-z]+$/,'codex '+c+' is a full id of the 5.6 generation');
  for(const agent of ['claude','codex']) assert.deepEqual(cfg('bench/repo','bench',3,agent).models,{[agent]:MODELS[agent]});
});

/* ---- sandbox seeding against a fake gh and a local origin (no network) ---- */
function fakeGh(root) {
  const bin=join(root,'bin');mkdirSync(bin,{recursive:true});
  writeFileSync(join(bin,'gh'),`#!${process.execPath}
const fs=require('fs');const a=process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG,JSON.stringify(a)+'\\n');
const counter=process.env.FAKE_GH_LOG+'.n';
const next=()=>{const n=(fs.existsSync(counter)?+fs.readFileSync(counter,'utf8'):10)+1;fs.writeFileSync(counter,String(n));return n;};
if(a[0]==='issue'&&a[1]==='create')console.log('https://github.com/o/r/issues/'+next());
else if(a[0]==='pr'&&a[1]==='create')console.log('https://github.com/o/r/pull/'+next());
else if(a[0]==='api'&&/\\/comments$/.test(a[1]))console.log(JSON.stringify({id:555}));
else if(a[0]==='api'&&a[1]==='graphql')console.log(JSON.stringify({data:{}}));
else if(a[0]==='api')console.log(JSON.stringify({node_id:'I_x'}));
else console.log('');
`);
  chmodSync(join(bin,'gh'),0o755);
  const log=join(root,'gh.log');writeFileSync(log,'');
  const env=setupEnv({token:'t',base:{PATH:bin+':'+process.env.PATH,HOME:root,FAKE_GH_LOG:log}});
  return {env,calls:()=>readFileSync(log,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l))};
}
test('seedIssues creates titled tickets in order, substitutes earlier numbers and returns them',()=>{
  const root=mkdtempSync(join(tmpdir(),'workflow-sandbox-'));
  try {
    const {env,calls}=fakeGh(root);
    const nums=seedIssues({repo:'o/r',id:'W3',projectId:'PVT_x',env});
    assert.deepEqual(nums,[11,12,13]);
    const creates=calls().filter(c=>c[0]==='issue'&&c[1]==='create');
    assert.deepEqual(creates.map(c=>c[c.indexOf('--title')+1]),scenarios.W3.issues.map(i=>i.title));
    assert.match(creates[2][creates[2].indexOf('--body')+1],/After #11 and #12/);
    assert.ok(!calls().some(c=>c[0]==='issue'&&c[1]==='edit'),'no body edit step');
    assert.deepEqual(seedIssues({repo:'o/r',id:'W1',projectId:'PVT_x',env}),[]);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('seedPR pushes the PR branch with a neutral author, opens it, comments and returns both ids',()=>{
  const root=mkdtempSync(join(tmpdir(),'workflow-sandbox-'));
  try {
    const {env,calls}=fakeGh(root);
    const origin=join(root,'origin.git'),seed=join(root,'work','seed');
    const run=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
    mkdirSync(seed,{recursive:true});
    run(root,'init','-q','--bare',origin);
    run(seed,'init','-q','-b','main');
    for(const [p,c] of Object.entries(fixture('W4'))){mkdirSync(join(seed,p,'..'),{recursive:true});writeFileSync(join(seed,p),c);}
    run(seed,'add','-A');run(seed,'-c','user.name=m','-c','user.email=m@example.invalid','commit','-qm','Initial commit');
    run(seed,'remote','add','origin',origin);run(seed,'push','-q','origin','HEAD:main');
    const result=seedPR({repo:'o/r',id:'W4',work:join(root,'work'),env});
    assert.deepEqual(result,{number:11,commentId:555});
    const sc=scenarios.W4.seedPR;
    assert.equal(run(origin,'log','-1','--format=%s|%an','refs/heads/'+sc.branch),sc.commitMessage+'|Maintainer');
    assert.match(run(origin,'show','refs/heads/'+sc.branch+':src/batch.mjs'),/processBatch/);
    assert.equal(run(origin,'rev-parse','refs/heads/main'),run(seed,'rev-parse','main'));
    const pr=calls().find(c=>c[0]==='pr'&&c[1]==='create');
    assert.equal(pr[pr.indexOf('--title')+1],sc.title);
    assert.equal(pr[pr.indexOf('--body')+1],sc.body);
    assert.ok(calls().some(c=>c[0]==='api'&&/issues\/11\/comments/.test(c[1])&&c.includes('body='+sc.comment)));
    assert.equal(seedPR({repo:'o/r',id:'W1',work:join(root,'work'),env}),null);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('instruction files above the work area are detected and refuse the work directory',()=>{
  const top=mkdtempSync(join(tmpdir(),'guidance-')),inner=join(top,'a/b');
  mkdirSync(inner,{recursive:true});mkdirSync(join(top,'.claude'));
  writeFileSync(join(top,'AGENTS.md'),'rules');writeFileSync(join(top,'.claude/CLAUDE.md'),'@AGENTS.md');
  try{
    assert.deepEqual(ancestorGuidance(inner).filter(f=>f.startsWith(top)).sort(),[join(top,'.claude/CLAUDE.md'),join(top,'AGENTS.md')]);
    const before=process.env.BENCHMARK_WORK_ROOT;
    process.env.BENCHMARK_WORK_ROOT=inner;
    try{assert.throws(()=>newWork(),/instruction or settings files above the work area/)}
    finally{before===undefined?delete process.env.BENCHMARK_WORK_ROOT:process.env.BENCHMARK_WORK_ROOT=before}
  }finally{rmSync(top,{recursive:true,force:true})}
});
