import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const version = readFileSync(new URL('VERSION', root), 'utf8').trim()
const json = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'))

test('VERSION is pinned semver X.Y.Z', () => {
    assert.match(version, /^\d+\.\d+\.\d+$/)
})

test('every plugin manifest that carries a version carries VERSION, and the two plugin files carry one', () => {
    for (const p of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) assert.equal(json(p).version, version, p)
    assert.equal(json('.claude-plugin/marketplace.json').plugins[0].version, version)
})

test('on a release run the tag is v<VERSION>', { skip: process.env.GITHUB_REF_TYPE !== 'tag' }, () => {
    assert.equal(process.env.GITHUB_REF_NAME, `v${version}`)
})

test('on a release run CHANGELOG.md has a section for VERSION', { skip: process.env.GITHUB_REF_TYPE !== 'tag' }, () => {
    assert.match(readFileSync(new URL('CHANGELOG.md', root), 'utf8'), new RegExp(`^## ${version.replaceAll('.', '\\.')}$`, 'm'))
})

test('the plugins expose init, sync and upstream: root skills/ holds exactly those, and there is no agents, commands, hooks or templates directory', () => {
    assert.deepEqual(readdirSync(new URL('skills/', root)).sort(), ['init', 'sync', 'upstream'])
    for (const d of ['agents', 'commands', 'hooks', 'templates']) assert.ok(!existsSync(new URL(`${d}/`, root)), d)
})
