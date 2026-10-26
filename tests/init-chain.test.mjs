import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { rawConfig, tempDir } from './helpers.mjs'

// The real core end to end: runtime, gen-stubs and render into a scratch repo, then doctor --local.
const ROOT = new URL('../', import.meta.url).pathname
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
const put = (dir, p, text) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text) }
const version = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()
const MODELS = { claude: { strong: 'opus', standard: 'sonnet', light: 'haiku' }, codex: { strong: null, standard: null, light: null } }

function source() {
    const dir = tempDir('chain-src-')
    for (const p of ['core', 'skills', 'practices', 'VERSION']) if (existsSync(join(ROOT, p))) cpSync(join(ROOT, p), join(dir, p), { recursive: true })
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'remote', 'add', 'origin', 'https://example.invalid/ticketflow.git')
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'src'); git(dir, 'tag', `v${version}`)
    return dir
}
function target(over = {}) {
    const dir = tempDir('chain-tgt-')
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git')
    put(dir, '.ticketflow/config.json', JSON.stringify(rawConfig({ agents: ['claude', 'codex'], models: MODELS, ...over })))
    put(dir, '.gitignore', '.claude/worktrees/\n')
    return dir
}
const node = (cwd, ...args) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })
const doctor = (dir) => node(dir, '.ticketflow/scripts/doctor.mjs', '--local')

test('runtime, gen-stubs and render give a repo that doctor --local accepts; a hand edit and a config change are caught', () => {
    const src = source(), dir = target()
    for (const args of [[join(src, 'core/scripts/runtime.mjs'), src, '.'], ['.ticketflow/scripts/gen-stubs.mjs', '.ticketflow', '.'], ['.ticketflow/scripts/render.mjs', '.ticketflow/templates', '.']]) {
        const r = node(dir, ...args)
        assert.equal(r.status, 0, `${args[0]}\n${r.stdout}${r.stderr}`)
    }
    for (const p of ['.claude/skills/implement-ticket/SKILL.md', '.agents/skills/create-ticket/SKILL.md', '.claude/agents/pr-reviewer.md', '.codex/agents/ticket-planner.toml', '.github/workflows/ci.yml', 'AGENTS.md', '.claude/settings.json']) assert.ok(existsSync(join(dir, p)), p)
    const manifest = JSON.parse(readFileSync(join(dir, '.ticketflow/manifest.json'), 'utf8'))
    assert.equal(manifest.version, version); assert.ok(manifest.claude_settings.allow.includes('Bash(node .ticketflow/scripts/doctor.mjs *)'))
    let r = doctor(dir)
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /doctor: 0 failed, 0 warnings/)

    // 2. a hand edit of a runtime file: doctor fails, runtime refuses, --keep records it and doctor only warns
    const merge = join(dir, '.ticketflow/scripts/merge.mjs')
    writeFileSync(merge, readFileSync(merge, 'utf8') + '// mine\n')
    r = doctor(dir)
    assert.equal(r.status, 1); assert.match(r.stdout, /fail runtime: edited: \.ticketflow\/scripts\/merge\.mjs/)
    assert.equal(node(dir, join(src, 'core/scripts/runtime.mjs'), src, '.').status, 1)
    const kept = node(dir, join(src, 'core/scripts/runtime.mjs'), src, '.', '--keep', '.ticketflow/scripts/merge.mjs')
    assert.equal(kept.status, 0, kept.stderr)
    r = doctor(dir)
    assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /warn runtime: ok, held/)

    // 3. a config change that reaches the templates: doctor fails `templates`, render repairs it
    const cfgFile = join(dir, '.ticketflow/config.json')
    writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(readFileSync(cfgFile, 'utf8')), areas: ['Api'] }))
    r = doctor(dir)
    assert.equal(r.status, 1); assert.match(r.stdout, /fail templates: /)
    assert.equal(node(dir, '.ticketflow/scripts/render.mjs', '.ticketflow/templates', '.').status, 0)
    r = doctor(dir)
    assert.equal(r.status, 0, r.stdout)
})

test('with practices: skills, rule stubs, AGENTS and PR lines appear; turning one off and syncing removes exactly what it added', () => {
    const src = source(), dir = target({ practices: ['i18n', 'domain-guides', 'live-verify'], live_verify_skill: 'live-verify' })
    put(dir, 'docs/agents/billing.md', '---\npaths:\n  - "src/billing/**"\n---\n# Billing\n\nInvariants.\n')
    const steps = () => [[join(src, 'core/scripts/runtime.mjs'), src, '.'], ['.ticketflow/scripts/gen-stubs.mjs', '.ticketflow', '.'], ['.ticketflow/scripts/render.mjs', '.ticketflow/templates', '.']]
    for (const args of steps()) { const r = node(dir, ...args); assert.equal(r.status, 0, `${args[0]}\n${r.stdout}${r.stderr}`) }
    for (const p of ['.ticketflow/practices/i18n/SKILL.md', '.claude/skills/i18n/SKILL.md', '.agents/skills/live-verify/SKILL.md', '.claude/agents/e2e-verifier.md', '.claude/rules/billing.md']) assert.ok(existsSync(join(dir, p)), p)
    assert.ok(!existsSync(join(dir, '.claude/skills/domain-guides')), 'domain-guides has no skill')
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    assert.match(agents, /Enabled practices[\s\S]*\.ticketflow\/practices\/i18n\/SKILL\.md[\s\S]*read each `docs\/agents\/\*\.md` guide/)
    assert.match(readFileSync(join(dir, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8'), /### Practice checks\n\n- \[ \] .*i18n/)
    let r = doctor(dir)
    assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /ok practices: i18n, domain-guides, live-verify/)

    // enabling later is a config edit and a sync: the practice is not in the runtime yet, so everything says so
    const cfgFile = join(dir, '.ticketflow/config.json')
    const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'))
    writeFileSync(cfgFile, JSON.stringify({ ...cfg, practices: ['i18n', 'domain-guides', 'live-verify', 'database'] }))
    r = doctor(dir)
    assert.equal(r.status, 1); assert.match(r.stdout, /fail practices: database enabled in the config but not in \.ticketflow\/practices\/: run sync/)

    // turning one off: runtime removes its folder, gen-stubs its stubs, render its lines
    writeFileSync(cfgFile, JSON.stringify({ ...cfg, practices: ['live-verify'], live_verify_skill: 'live-verify' }))
    for (const args of steps()) { const x = node(dir, ...args); assert.equal(x.status, 0, `${args[0]}\n${x.stdout}${x.stderr}`) }
    for (const p of ['.ticketflow/practices/i18n', '.claude/skills/i18n', '.claude/rules/billing.md']) assert.ok(!existsSync(join(dir, p)), p)
    assert.ok(existsSync(join(dir, '.claude/skills/live-verify/SKILL.md')) && existsSync(join(dir, 'docs/agents/billing.md')))
    assert.doesNotMatch(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /i18n\/SKILL\.md/)
    r = doctor(dir)
    assert.equal(r.status, 0, r.stdout)
})
