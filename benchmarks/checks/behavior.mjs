#!/usr/bin/env node
/** Generic hidden behavioural benchmark check (never copied into an agent workspace). */
import { readFileSync } from 'node:fs'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const [dir, , scenario] = process.argv.slice(2)
const fail = (s) => { console.log('FAIL: ' + s); process.exit(1) }
if (!dir || !scenario) fail('missing scenario path')
let config
try { config = JSON.parse(readFileSync(join(scenario, 'cases.json'), 'utf8')) }
catch { fail('invalid hidden cases') }
let mod
try { mod = await import(pathToFileURL(join(dir, config.module)).href) }
catch (e) { fail('module does not load: ' + e.message) }
const fn = mod[config.export]
if (typeof fn !== 'function') fail('missing exported function ' + config.export)
for (const [i, entry] of config.cases.entries()) {
    const args = structuredClone(entry.args)
    const before = config.immutableArgs ? structuredClone(args) : null
    let result, failed = false
    try { result = await fn(...args) }
    catch (e) { failed = true; result = e?.message }
    if (config.immutableArgs) {
        try { assert.deepStrictEqual(args, before) }
        catch { fail('case ' + i + ' mutated its input arguments') }
    }
    if (entry.throws) {
        if (!failed || !new RegExp(entry.throws).test(String(result))) fail('case ' + i + ' must reject invalid input')
    } else {
        if (failed) fail('case ' + i + ' threw ' + result)
        try { assert.deepStrictEqual(result, entry.want) }
        catch { fail('case ' + i + ' expected ' + JSON.stringify(entry.want) + ', got ' + JSON.stringify(result)) }
    }
}
const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
if (spawnSync('npm', ['test', '--silent'], { cwd: dir, env, timeout: 60000 }).status !== 0) fail('repo tests fail')
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) if (Object.keys(pkg[k] ?? {}).length) fail('added a dependency')
if (config.requireTest) {
    const root = spawnSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    const names = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout
        .split('\n').map((s) => s.trim().replaceAll('\\', '/')).filter(Boolean)
    const committed = names('diff', '--name-only', '--diff-filter=AM', root, 'HEAD')
    const unstaged = names('diff', '--name-only', '--diff-filter=AM')
    const staged = names('diff', '--cached', '--name-only', '--diff-filter=AM')
    const untracked = names('ls-files', '--others', '--exclude-standard')
    const tests = [...new Set([...committed, ...unstaged, ...staged, ...untracked])]
        .filter((s) => /(?:^|\/)(?:spec|tests?)\/.*\.[cm]?js$|\.(?:test|spec)\.[cm]?js$/.test(s))
    if (!tests.length) fail('no regression test was written')
    if (spawnSync(process.execPath, ['--test', ...tests], { cwd: dir, env, encoding: 'utf8' }).status !== 0)
        fail(`${tests.join(', ')} fails on the repaired source`)
    const old = mkdtempSync(join(tmpdir(), 'behavior-original-'))
    try {
        cpSync(dir, old, { recursive: true })
        spawnSync('git', ['checkout', root, '--', '.'], { cwd: old, env, stdio: 'ignore' })
        const leftovers = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: old, env, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
        for (const file of leftovers) if (!tests.includes(file)) rmSync(join(old, file), { recursive: true, force: true })
        for (const file of tests) {
            const source = join(dir, file), target = join(old, file)
            mkdirSync(join(target, '..'), { recursive: true })
            cpSync(source, target, { recursive: true })
        }
        if (spawnSync(process.execPath, ['--test', ...tests], { cwd: old, env, encoding: 'utf8' }).status === 0)
            fail(`${tests.join(', ')} passes on the original source`)
    } finally { rmSync(old, { recursive: true, force: true }) }
}
console.log('PASS: hidden behaviour, existing suite and dependency budget')
