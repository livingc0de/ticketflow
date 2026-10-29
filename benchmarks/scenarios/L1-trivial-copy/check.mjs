#!/usr/bin/env node
// Hidden check for L1 (never copied into the agent's repo). Usage: check.mjs <repo-dir> [<answer-file>]. Exit 0 = pass, 1 = fail; prints why.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = process.argv[2]
const fail = (why) => { console.log(`FAIL: ${why}`); process.exit(1) }
const { messages } = await import(pathToFileURL(join(dir, 'src/messages.js')).href).catch((e) => fail(`src/messages.js does not load: ${e.message}`))
const want = {
    welcome: 'Welcome back!',
    saved: 'Your changes were saved. You will receive a confirmation email shortly.',
    failed: 'Something went wrong. Please try again.',
}
if (JSON.stringify(messages) !== JSON.stringify(want)) fail(`messages are ${JSON.stringify(messages)}`)
const { NODE_TEST_CONTEXT, ...env } = process.env   // a nested node --test must not think it is a subtest
if (spawnSync('npm', ['test', '--silent'], { cwd: dir, env }).status !== 0) fail('the repo\'s own tests fail')
console.log('PASS: the typo is fixed, nothing else changed in the messages, the repo tests pass')
