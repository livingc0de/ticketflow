#!/usr/bin/env node
/** Combined maintainer launcher for the local and full workflow benchmark suites. */
import {parseArgs} from 'node:util';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=dirname(fileURLToPath(import.meta.url));
try{
  const {values:v}=parseArgs({options:{config:{type:'string'},suite:{type:'string'},execute:{type:'boolean'}}});
  const suite=v.suite??'both';
  if(!v.config||!['local','workflow','both'].includes(suite))
    throw Error('usage: run --config PLAN.json [--suite local|workflow|both] [--execute]');
  const cfg=JSON.parse(readFileSync(resolve(v.config),'utf8'));
  const suites=suite==='both'?['local','workflow']:[suite];
  for(const suite of suites){
    const args=cfg[suite];
    if(!Array.isArray(args)||args.some(x=>typeof x!=='string'||!x.length))throw Error('config.'+suite+' must be an array of CLI argument strings');
    if(args.some(x=>x==='--execute'||x.startsWith('--execute=')))throw Error('put --execute on run only, not in the config');
  }
  for(const suite of suites){
    const target=suite==='local'?'run-local.mjs':'run-workflow.mjs';
    const args=[join(HERE,target),...cfg[suite],...(v.execute?['--execute']:[])];
    console.log('\n=== '+suite+' benchmark '+(v.execute?'PAID':'DRY RUN')+' ===');
    const r=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
    if(r.error||r.status!==0)throw Error(suite+' runner exited '+String(r.error?.message??r.status??r.signal)+'; subsequent suites were not started');
  }
}catch(e){console.error('run: '+e.message);process.exitCode=2;}
