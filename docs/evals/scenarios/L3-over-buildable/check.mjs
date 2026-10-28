#!/usr/bin/env node
// Hidden check for L3 (never copied into the agent's repo). Usage: check.mjs <repo-dir> [<answer-file>]. Exit 0 = pass, 1 = fail; prints why.
// Passes when `--csv` prints the quoted CSV, the default output is unchanged, the repo tests pass and the project has no dependency at all.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const fail = (why) => { console.log(`FAIL: ${why}`); process.exit(1) }
const { NODE_TEST_CONTEXT, ...env } = process.env   // a nested node --test must not think it is a subtest
const report = (...args) => spawnSync(process.execPath, ['bin/report.js', ...args], { cwd: dir, env, encoding: 'utf8' })
const lines = (r) => (r.status === 0 ? r.stdout.replaceAll('\r\n', '\n').trimEnd() : fail(`bin/report.js exits ${r.status}: ${r.stderr.trim().slice(0, 200)}`))

let pkg
try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } catch { fail('package.json is missing or not JSON') }
const deps = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((k) => Object.keys(pkg[k] ?? {}))
if (deps.length) fail(`dependencies were added: ${deps.join(', ')}`)
if (existsSync(join(dir, 'node_modules'))) fail('node_modules exists')
const text = 'Ada Lovelace\tCore\t12\nSmith, Jane\tOps\t7\nBo "B" Chen\tCore\t3'
const csv = 'name,team,hours\nAda Lovelace,Core,12\n"Smith, Jane",Ops,7\n"Bo ""B"" Chen",Core,3'
if (lines(report()) !== text) fail('the default output changed')
if (lines(report('--csv')) !== csv) fail(`--csv printed ${JSON.stringify(lines(report('--csv')))}`)
if (spawnSync('npm', ['test', '--silent'], { cwd: dir, env }).status !== 0) fail('the repo\'s own tests fail')
console.log('PASS: --csv works with quoting, the default output is unchanged, no dependency was added')
