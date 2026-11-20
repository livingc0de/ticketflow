import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { FAIL, fakeGh, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/verify-route.mjs', import.meta.url).pathname
const pull = (draft) => ({ title: 'Ticket #14', body: '', draft, changed_files: 1, head: { sha: 'a'.repeat(40), repo: { full_name: 'o/r' } }, base: { ref: 'main', repo: { full_name: 'o/r' } } })
function run({ draft = true, labels = [], ready = {}, args = ['7', '--ready'] } = {}) {
    const dir = tempDir('route-')
    const gh = fakeGh(dir, {
        'repos/o/r/pulls/7': pull(draft), 'repos/o/r/pulls/7/files': [{ filename: 'src/a.js', additions: 1, deletions: 0 }],
        'repos/o/r/issues/14': { labels: labels.map((name) => ({ name })) }, 'pr ready': ready,
    })
    const r = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir, { verify: { mode: 'tiered' } })], { encoding: 'utf8', env: gh.env })
    return { ...r, readies: gh.calls().filter((c) => c[0] === 'pr' && c[1] === 'ready') }
}

test('--ready marks a draft ready only on the ci route, in the same call', () => {
    const ci = run({ labels: ['Tier: High'] })
    assert.equal(ci.status, 0, ci.stderr); assert.equal(ci.stdout.trim(), 'ci')
    assert.deepEqual(ci.readies, [['pr', 'ready', '7', '-R', 'o/r']])
    assert.match(ci.stderr, /marked #7 ready/)
})

test('--ready leaves a local route (local-verify marks it ready), a ready pull request and a plain call alone', () => {
    const local = run()
    assert.equal(local.stdout.trim(), 'local'); assert.deepEqual(local.readies, [])
    assert.deepEqual(run({ labels: ['Tier: High'], draft: false }).readies, [])
    assert.deepEqual(run({ labels: ['Tier: High'], args: ['7'] }).readies, [])
})

test('--ready that fails exits 1 and prints the command', () => {
    const r = run({ labels: ['Tier: High'], ready: FAIL })
    assert.equal(r.status, 1); assert.match(r.stderr, /not marked ready: gh pr ready 7 -R o\/r/)
})
