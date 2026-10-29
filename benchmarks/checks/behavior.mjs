#!/usr/bin/env node
/** Generic hidden behavioural benchmark check (never copied into an agent workspace). */
import { readFileSync } from 'node:fs'
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
    let result, failed = false
    try { result = await fn(...args) }
    catch (e) { failed = true; result = e?.message }
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
for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) if (Object.keys(pkg[k] ?? {}).length) fail('added a dependency')
if (config.requireTest) {
    const root = spawnSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    const changed = spawnSync('git', ['diff', '--name-only', root, 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout
    const uncommitted = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout
    if (!(changed + uncommitted).split('\n').some((s) => /(?:\/spec\/|\/test\/|spec\/|test\/|\.test\.)/.test(s))) fail('no regression test was written')
}
console.log('PASS: hidden behaviour, existing suite and dependency budget')
