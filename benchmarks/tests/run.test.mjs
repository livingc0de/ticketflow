import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../../tests/helpers.mjs'

const ROOT = new URL('../', import.meta.url).pathname
const CLI = join(ROOT, 'run.mjs')
const call = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
const git = (dir, ...args) => execFileSync('git', ['-c','user.name=t','-c','user.email=t@example.invalid', ...args], { cwd: dir, encoding: 'utf8' }).trim()
const source = (external = false, agent = 'claude') => {
    const dir = tempDir('bench-source-')
    const marker = external ? (agent === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json') : 'core/scripts/runtime.mjs'
    mkdirSync(join(dir, marker, '..'), { recursive: true })
    writeFileSync(join(dir, marker), external ? '{}\n' : '// test source\n')
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'pinned')
    return dir
}

test('dry-run shows every repeat and arm, requires no agent executable or output file', () => {
    const before = source(), out = join(tempDir('bench-out-'), 'rows.jsonl')
    const r = call(['--agent','claude','--model','test-model','--arms','before,after,bare','--scenarios','L1,L2',
        '--repeats','2','--before-source',before,'--out',out])
    assert.equal(r.status, 0, r.stderr)
    const info = JSON.parse(r.stdout.split('\nPLAN ')[0])
    assert.equal(info.total, 12)
    assert.equal(info.remaining, 12)
    assert.match(r.stdout, /DRY RUN \(free\)/)
    assert.equal(existsSync(out), false)
    assert.equal(r.stdout.split('\n').filter((x)=>x.startsWith('PLAN ')).length, 12)
})

test('paid execution is refused before invoking any agent if the cap is too low', () => {
    const r = call(['--agent','claude','--model','test','--arms','bare','--scenarios','L1,L2',
        '--repeats','2','--out',join(tempDir('bench-out-'), 'rows.jsonl'),'--max-sessions','1','--execute'])
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /paid sessions exceeds --max-sessions/)
    assert.doesNotMatch(r.stdout, /SESSION /)
})

test('resume skips only matching fully identified runs', () => {
    const dir = tempDir('bench-out-'), out = join(dir, 'rows.jsonl')
    writeFileSync(out, JSON.stringify({ scenario:'L1-trivial-copy', arm:'bare', variant:'bare', repeat:1, requested_model:'test',
        agent:'claude', ticketflow_sha:null, plugin_sha:null, eval_sha:git(ROOT,'rev-parse','HEAD'), check:{pass:false} }) + '\n')
    const args = ['--agent','claude','--model','test','--arms','bare','--scenarios','L1','--repeats','2','--out',out,'--resume']
    const good = call(args)
    assert.equal(good.status, 0, good.stderr)
    const info = JSON.parse(good.stdout.split('\nPLAN ')[0])
    assert.equal(info.remaining, 1)
    assert.equal(info.already_recorded, 1)
    assert.match(good.stdout, /PLAN L1 bare rep=2/)
    assert.equal(readFileSync(out, 'utf8').split('\n').filter(Boolean).length, 1)
})

test('before and after must be different revisions', () => {
    const before=source()
    const r=call(['--agent','claude','--model','test','--arms','before,after','--before-source',before,'--after-source',before])
    assert.equal(r.status,2)
    assert.match(r.stderr,/different pinned revisions/)
})

test('Codex can preview the complete five-arm matrix with native pinned plugin sources', () => {
    const before = source(), superpowers = source(true, 'codex'), ponytail = source(true, 'codex')
    const r = call(['--agent','codex','--model','gpt-test','--arms','before,after,bare,superpowers,ponytail',
        '--before-source',before,'--superpowers-source',superpowers,'--ponytail-source',ponytail,
        '--scenarios','L1,L2','--repeats','1'])
    assert.equal(r.status, 0, r.stderr)
    const info = JSON.parse(r.stdout.split('\nPLAN ')[0])
    assert.equal(info.total, 10)
    assert.equal(r.stdout.split('\n').filter((x) => x.startsWith('PLAN ')).length, 10)
})

test('invalid paths and missing native Codex manifests are rejected without paid work', () => {
    for (const args of [
        ['--agent','claude','--model','m','--arms','before'],
        ['--agent','claude','--model','m','--arms','bare','--scenarios','L99'],
        ['--agent','claude','--model','m','--arms','bare,bare'],
        ['--agent','codex','--model','m','--arms','superpowers','--superpowers-source',source(true,'claude')],
    ]) {
        const r = call(args)
        assert.equal(r.status, 2, args.join(' ') + '\n' + r.stderr)
        assert.doesNotMatch(r.stdout, /SESSION /)
    }
})
