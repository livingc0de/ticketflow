#!/usr/bin/env node
// Hidden check for L4 (never copied into the agent's repo). Usage: check.mjs <repo-dir> <answer-file>. Exit 0 = pass, 1 = fail; prints why.
// Passes when one line of the answer cites the join that builds the path, `src/files.js:7` (or a range from 7 to 9, nothing wider), and says it is a
// path traversal (traversal, `..`, escape, outside, arbitrary file), and nothing in the repo changed.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [dir, answerFile] = process.argv.slice(2)
const fail = (why) => { console.log(`FAIL: ${why}`); process.exit(1) }
const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim()
if (git('status', '--porcelain')) fail(`files were changed: ${git('status', '--porcelain').replaceAll('\n', ', ')}`)
if (git('rev-list', '--count', 'HEAD') !== '1') fail('a commit was made')
let answer
try { answer = readFileSync(answerFile, 'utf8') } catch { fail('no answer was captured') }
const CAUSE = /travers|\.\.|dot-dot|escap|outside|arbitrary file/i
const hit = answer.split('\n').some((line) => CAUSE.test(line) && [...line.matchAll(/files\.js:L?(\d+)(?:\s*[-\u2013]\s*L?(\d+))?/g)].some(([, a, b]) => +a === 7 && +(b ?? a) <= 9 && +(b ?? a) >= 7))
if (!hit) fail('no line of the answer names src/files.js:7 (or 7-9) together with the path traversal')
console.log('PASS: the traversal bug is named at src/files.js:7-9 and nothing was edited')
