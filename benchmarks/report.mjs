#!/usr/bin/env node
/** Combined maintainer reporter for local and full workflow benchmark ledgers. */
import {parseArgs} from 'node:util';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=dirname(fileURLToPath(import.meta.url));
try{
  const {values:v}=parseArgs({options:{config:{type:'string'},suite:{type:'string'}}});
  const suite=v.suite??'both';
  if(!v.config||!['local','workflow','both'].includes(suite))
    throw Error('usage: report --config PLAN.json [--suite local|workflow|both]');
  const cfg=JSON.parse(readFileSync(resolve(v.config),'utf8'));
  const suites=suite==='both'?['local','workflow']:[suite];
  for(const name of suites){
    const args=cfg[name];
    if(!Array.isArray(args)||args.some(x=>typeof x!=='string'||!x.length))
      throw Error('config.'+name+' must be an array of CLI argument strings');
  }
  for(const name of suites){
    const target=name==='local'?'report-local.mjs':'report-workflow.mjs';
    const args=[join(HERE,target),...cfg[name]];
    console.log('\n=== '+name+' report ===');
    const r=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
    if(r.error||r.status!==0)
      throw Error(name+' reporter exited '+String(r.error?.message??r.status??r.signal)+'; subsequent reports were not started');
  }
}catch(e){console.error('report: '+e.message);process.exitCode=2;}
