import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyOutcome,outcomeOf,latestAttempts} from './outcome.mjs';
const delivery={pipeline:true,error:null};
const part=(extra={})=>({exit:0,interrupted:false,reason:null,archive_error:null,cleanup_error:null,...extra});
const status=(d=delivery,parts=[part()],external=null,cleanup='ok')=>
  classifyOutcome({delivery:d,invocations:parts,plugin_bootstrap:external,profile_cleanup:cleanup});

test('genuine coding, delivery and agent execution failures count against the arm',()=>{
  assert.equal(status().status,'success');
  assert.equal(status({...delivery,pipeline:false}).status,'failure');
  assert.equal(status(delivery,[part({exit:1})]).status,'failure');
  assert.equal(status(delivery,[part({exit:null,signal:'SIGKILL',reason:'timeout'})]).status,'failure');
});
test('harness and evidence failures invalidate rather than count as failures',()=>{
  assert.deepEqual(status({...delivery,error:'GitHub unavailable'}),{
    status:'invalid',invalid_reasons:['evaluation_unavailable']});
  assert.deepEqual(status(delivery,[part({archive_error:'EACCES'})]).invalid_reasons,['transcript_archive_failed']);
  assert.deepEqual(status(delivery,[part({cleanup_error:'failed'})]).invalid_reasons,['plugin_cleanup_failed']);
  assert.deepEqual(status(delivery,[part()],{status:'unknown'}).invalid_reasons,['plugin_activation_unverified']);
  assert.deepEqual(status(delivery,[part()],null,'failed').invalid_reasons,['plugin_cleanup_failed']);
  assert.deepEqual(status(delivery,[part({exit:null,signal:'error'})]).invalid_reasons,['agent_launch_failed']);
});
test('W5 planned interruption is not a failure when its fresh session completes',()=>{
  const first=part({exit:null,interrupted:true,reason:'remote checkpoint reached',signal:'SIGTERM'});
  assert.equal(status(delivery,[first,part()]).status,'success');
  assert.equal(status(delivery,[first,part({exit:1})]).status,'failure');
  assert.equal(status(delivery,[first,part({archive_error:'out of disk'})]).status,'invalid');
});
test('only the latest retry of a cell is scored while preserving the raw attempts',()=>{
  const cell=(n,outcome)=>({scenario:'W2',arm:'bare',repeat:1,agent:'claude',
    eval_fingerprint:'fixed',requested_model:'m',requested_effort:'high',attempt:n,outcome});
  const recorded=[cell(1,'invalid'),cell(2,'success'),cell(1,'failure')];
  const active=latestAttempts(recorded);
  assert.equal(active.length,1);
  assert.equal(active[0].outcome,'failure');
  assert.equal(recorded.length,3);
  assert.equal(outcomeOf(recorded[0]),'invalid');
  assert.equal(outcomeOf({check:{pass:true}}),'success');
  assert.equal(outcomeOf({check:{pass:false}}),'failure');
});
