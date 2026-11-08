import test from 'node:test';
import assert from 'node:assert/strict';
import {asksToContinue,classifyOutcome,outcomeOf,latestAttempts} from './outcome.mjs';
const facts={errors:[]};
const part=(extra={})=>({exit:0,archive_error:null,cleanup_error:null,...extra});
const status=(f=facts,parts=[part()],external=null,cleanup='ok')=>
  classifyOutcome({facts:f,invocations:parts,plugin_bootstrap:external,profile_cleanup:cleanup});

test('a cell with complete facts is scored, whatever the agent achieved',()=>{
  assert.deepEqual(status(),{status:'scored',invalid_reasons:[]});
  assert.equal(status(facts,[part({exit:1})]).status,'scored');
  assert.equal(status(facts,[part({exit:null,signal:'SIGKILL',reason:'timeout'})]).status,'scored');
  // a planned interruption of an earlier session is not an error either
  assert.equal(status(facts,[part({exit:null,signal:'SIGTERM',interrupted:true}),part()]).status,'scored');
});
test('harness and evidence failures invalidate rather than count against an arm',()=>{
  assert.deepEqual(status({errors:['issues: GitHub unavailable']}),{status:'invalid',invalid_reasons:['evaluation_unavailable']});
  assert.deepEqual(status(null).invalid_reasons,['evaluation_unavailable']);
  assert.deepEqual(status(facts,[part({archive_error:'EACCES'})]).invalid_reasons,['transcript_archive_failed']);
  assert.deepEqual(status(facts,[part({cleanup_error:'failed'})]).invalid_reasons,['plugin_cleanup_failed']);
  assert.deepEqual(status(facts,[part()],{status:'unknown'}).invalid_reasons,['plugin_activation_unverified']);
  assert.deepEqual(status(facts,[part()],null,'failed').invalid_reasons,['plugin_cleanup_failed']);
  assert.deepEqual(status(facts,[part({exit:null,signal:'error'})]).invalid_reasons,['agent_launch_failed']);
  assert.deepEqual(status({errors:['x']},[part({archive_error:'e'})]).invalid_reasons,['evaluation_unavailable','transcript_archive_failed']);
});
test('asksToContinue reads only the final paragraph',()=>{
  assert.equal(asksToContinue('Done with the export.\n\nShould I continue with the remaining tickets?'),true);
  assert.equal(asksToContinue('Two of three finished. Want me to go on?'),true);
  assert.equal(asksToContinue('I stopped here.\n\nLet me know if you\'d like me to keep going.'),true);
  assert.equal(asksToContinue('Done. Anything else?'),false);
  assert.equal(asksToContinue('All finished. Want me to also add docs?'),false);
  assert.equal(asksToContinue('Which database do you prefer?'),false);
  assert.equal(asksToContinue('Here is the design.\n\nShall I proceed with the implementation?'),true);
  assert.equal(asksToContinue('Why was this unclear? I looked.\n\nAll three tickets are done and pushed.'),false);
  assert.equal(asksToContinue(''),false);
  assert.equal(asksToContinue(null),false);
});
test('only the latest retry of a cell is scored while preserving the raw attempts',()=>{
  const cell=(n,outcome)=>({scenario:'W2',arm:'bare',repeat:1,agent:'claude',
    eval_fingerprint:'fixed',requested_model:'m',requested_effort:'high',attempt:n,outcome});
  const recorded=[cell(1,'invalid'),cell(2,'scored'),cell(1,'invalid')];
  const active=latestAttempts(recorded);
  assert.equal(active.length,1);
  assert.equal(active[0].outcome,'invalid');
  assert.equal(recorded.length,3);
  assert.equal(outcomeOf(recorded[0]),'invalid');
  assert.equal(outcomeOf(recorded[1]),'scored');
  assert.equal(outcomeOf({check:{pass:true}}),'success');
  assert.equal(outcomeOf({check:{pass:false}}),'failure');
});
