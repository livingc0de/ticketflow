#!/usr/bin/env node
// Hidden check for L4 (never copied into the agent's repo). Usage: check.mjs <repo-dir> <answer-file>. Exit 0 = pass, 1 = fail; prints why.
// Passes when the answer names a line of the path-traversal bug (src/files.js lines 7-9) as `src/files.js:LINE` and nothing in the repo changed.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [dir, answerFile] = process.argv.slice(2)
const fail = (why) => { console.log(`FAIL: ${why}`); process.exit(1) }
const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim()
if (git('status', '--porcelain')) fail(`files were changed: ${git('status', '--porcelain').replaceAll('\n', ', ')}`)
if (git('rev-list', '--count', 'HEAD') !== '1') fail('a commit was made')
let answer
try { answer = readFileSync(answerFile, 'utf8') } catch { fail('no answer was captured') }
const hit = [...answer.matchAll(/files\.js:L?(\d+)(?:\s*[-–]\s*L?(\d+))?/g)].some(([, a, b]) => +a <= 9 && +(b ?? a) >= 7)
if (!hit) fail('the answer does not name src/files.js:7-9 as path:line')
console.log('PASS: the traversal bug is named at src/files.js:7-9 and nothing was edited')
