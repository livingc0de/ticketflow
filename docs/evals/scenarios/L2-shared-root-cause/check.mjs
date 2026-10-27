#!/usr/bin/env node
// Hidden check for L2 (never copied into the agent's repo). Usage: check.mjs <repo-dir> [<answer-file>]. Exit 0 = pass, 1 = fail; prints why.
// Passes when both callers of the shared helper round half-cents correctly, the repo tests pass and a new or changed test fails on the original src/.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = process.argv[2]
const fail = (why) => { console.log(`FAIL: ${why}`); process.exit(1) }
const { NODE_TEST_CONTEXT, ...env } = process.env   // a nested node --test must not think it is a subtest
const run = (cwd, cmd, ...args) => spawnSync(cmd, args, { cwd, env, encoding: 'utf8' })
const load = (f) => import(pathToFileURL(join(dir, f)).href).catch((e) => fail(`${f} does not load: ${e.message}`))

const { lineTotal } = await load('src/invoice.js')
const { refundAmount } = await load('src/refund.js')
const cases = [
    ['lineTotal(1, 1.005)', lineTotal(1, 1.005), 1.01], ['lineTotal(1, 10.075)', lineTotal(1, 10.075), 10.08],
    ['lineTotal(2, 1.5)', lineTotal(2, 1.5), 3], ['lineTotal(3, 19.99)', lineTotal(3, 19.99), 59.97],
    ['refundAmount(100.5, 1)', refundAmount(100.5, 1), 1.01], ['refundAmount(1007.5, 1)', refundAmount(1007.5, 1), 10.08],
    ['refundAmount(80, 25)', refundAmount(80, 25), 20], ['refundAmount(33.33, 100)', refundAmount(33.33, 100), 33.33],
]
for (const [what, got, want] of cases) if (got !== want) fail(`${what} is ${got}, expected ${want}`)
if (run(dir, 'npm', 'test', '--silent').status !== 0) fail('the repo\'s own tests fail')

run(dir, 'git', 'add', '-A')   // the repo is a throwaway: stage everything so new files count
const root = run(dir, 'git', 'rev-list', '--max-parents=0', 'HEAD').stdout.trim()
const tests = run(dir, 'git', 'diff', '--cached', '--name-only', '--diff-filter=AM', root).stdout.split('\n').filter((f) => /(^|\/)(spec|tests?)\/.+\.[cm]?js$/.test(f))
if (!tests.length) fail('no test was added or changed')
const old = mkdtempSync(join(tmpdir(), 'l2-'))
try {
    cpSync(dir, old, { recursive: true })
    rmSync(join(old, 'src'), { recursive: true })
    run(old, 'git', 'checkout', root, '--', 'src')
    if (run(old, process.execPath, '--test', ...tests).status === 0) fail(`${tests.join(', ')} passes on the original src/: it does not catch the bug`)
} finally { rmSync(old, { recursive: true, force: true }) }
console.log(`PASS: both callers are correct, ${tests.join(', ')} fails on the original code, the repo tests pass`)
