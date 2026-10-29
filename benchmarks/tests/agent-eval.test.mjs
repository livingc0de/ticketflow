import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../../tests/helpers.mjs'
import { resolveScenario } from '../lib/integrity.mjs'

const ROOT = new URL('../../', import.meta.url).pathname
const TOOL = join(ROOT, 'benchmarks/agent-eval.mjs')
const SCEN = join(ROOT, 'benchmarks/scenarios')
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
const put = (dir, p, text) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), text) }
const edit = (dir, p, from, to) => put(dir, p, readFileSync(join(dir, p), 'utf8').replace(from, to))

// ---- the four scenarios: each hidden check fails on the untouched repo and passes on a reference fix ----

/** The scenario's repo/ as a one-commit git repo, like the harness makes it. */
function fixture(id) {
    const dir = tempDir('scen-')
    cpSync(join(SCEN, id, 'repo'), dir, { recursive: true })
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base')
    return dir
}
const check = (id, dir, answer) => {
    const args = [join(SCEN, id, 'check.mjs'), dir]
    if (answer !== undefined) { const f = join(tempDir('ans-'), 'answer.txt'); writeFileSync(f, answer); args.push(f) }
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' })
    return { status: r.status, out: r.stdout + r.stderr }
}
const failing = (id, dir, why, answer) => { const r = check(id, dir, answer); assert.equal(r.status, 1, r.out); assert.match(r.out, why) }
const passing = (id, dir, answer) => { const r = check(id, dir, answer); assert.equal(r.status, 0, r.out); assert.match(r.out, /^PASS/) }

const L1 = 'L1-trivial-copy', L2 = 'L2-shared-root-cause', L3 = 'L3-over-buildable', L4 = 'L4-review-diff'
const fixL1 = (dir) => edit(dir, 'src/messages.js', 'recieve', 'receive')
const EXACT = 'return Number(Math.round(`${amount}e2`) + \'e-2\')'
const fixL2 = (dir) => {
    edit(dir, 'src/money.js', 'return Math.round(amount * 100) / 100', EXACT)
    put(dir, 'spec/rounding.spec.js', "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { roundMoney } from '../src/money.js'\ntest('half cents round up', () => assert.equal(roundMoney(1.005), 1.01))\n")
}
const CSV_CLI = `import { readFileSync } from 'node:fs'
import { formatText } from '../src/report.js'

const rows = JSON.parse(readFileSync(new URL('../data/rows.json', import.meta.url), 'utf8'))
const cell = (v) => (/[",\\n]/.test(v) ? \`"\${String(v).replaceAll('"', '""')}"\` : String(v))
const csv = (rs) => ['name,team,hours', ...rs.map((r) => [r.name, r.team, r.hours].map(cell).join(','))].join('\\n')
console.log(process.argv.includes('--csv') ? csv(rows) : formatText(rows))
`
const fixL3 = (dir) => put(dir, 'bin/report.js', CSV_CLI)

test('L1: fails on the untouched repo and on a collateral edit, passes on the fix', () => {
    const dir = fixture(L1)
    failing(L1, dir, /messages are .*recieve/)
    edit(dir, 'src/messages.js', 'Welcome back!', 'Welcome!'); fixL1(dir)
    failing(L1, dir, /messages are/)
    edit(dir, 'src/messages.js', 'Welcome!', 'Welcome back!')
    passing(L1, dir)

    put(dir, 'spec/broken.spec.js', "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('broken', () => assert.equal(1, 2))\n")   // the fix is right, the repo's own suite is not
    failing(L1, dir, /the repo's own tests fail/)
    put(dir, 'src/messages.js', 'export const messages = {')   // the module does not even load
    failing(L1, dir, /src\/messages\.js does not load/)
})

test('L2: needs both callers right, the suite green and a new test that fails on the original code', () => {
    const dir = fixture(L2)
    failing(L2, dir, /lineTotal\(1, 1\.005\) is 1, expected 1\.01/)

    edit(dir, 'src/invoice.js', 'roundMoney(quantity * unitPrice)', 'roundMoney(quantity * unitPrice + 1e-9)')   // the symptom only
    failing(L2, dir, /refundAmount\(100\.5, 1\) is 1, expected 1\.01/)
    git(dir, 'checkout', '-q', '--', 'src')

    edit(dir, 'src/invoice.js', 'roundMoney(quantity * unitPrice)', 'roundMoney(quantity * unitPrice + 1e-9)')   // both callers patched, the shared helper still wrong
    edit(dir, 'src/refund.js', 'roundMoney((paid * percent) / 100)', 'roundMoney((paid * percent) / 100 + 1e-9)')
    failing(L2, dir, /roundMoney\(1\.005\) is 1, expected 1\.01/)
    git(dir, 'checkout', '-q', '--', 'src')

    edit(dir, 'src/money.js', 'return Math.round(amount * 100) / 100', 'return Math.round((amount + Number.EPSILON) * 100) / 100')   // fixes 1.005, not 10.075
    failing(L2, dir, /10\.075\) is 10\.07, expected 10\.08/)
    git(dir, 'checkout', '-q', '--', 'src')

    edit(dir, 'src/money.js', 'return Math.round(amount * 100) / 100', EXACT)
    failing(L2, dir, /no test was added or changed/)

    put(dir, 'spec/vacuous.spec.js', "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('nothing', () => assert.equal(1, 1))\n")
    failing(L2, dir, /passes on the original src\/: it does not catch the bug/)

    put(dir, 'spec/vacuous.spec.js', "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('broken', () => assert.equal(1, 2))\n")
    failing(L2, dir, /the repo's own tests fail/)

    const ok = fixture(L2)
    fixL2(ok)
    passing(L2, ok)

    // a test outside spec/ is not run by `npm test`: the check runs the changed tests itself, on the repaired source first
    put(ok, 'test/regression.test.js', "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('broken', () => assert.equal(1, 2))\n")
    failing(L2, ok, /test\/regression\.test\.js fails on the repaired src\//)
    const placed = fixture(L2)   // the same fix with a correct regression test that lives in test/
    edit(placed, 'src/money.js', 'return Math.round(amount * 100) / 100', EXACT)
    put(placed, 'test/regression.test.js', "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { roundMoney } from '../src/money.js'\ntest('half cents round up', () => assert.equal(roundMoney(1.005), 1.01))\n")
    passing(L2, placed)
    const colocated = fixture(L2)   // a regression test next to the code it tests counts as a test
    edit(colocated, 'src/money.js', 'return Math.round(amount * 100) / 100', EXACT)
    put(colocated, 'src/money.test.js', "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { roundMoney } from './money.js'\ntest('half cents round up', () => assert.equal(roundMoney(1.005), 1.01))\n")
    passing(L2, colocated)
    const inSrc = fixture(L2)   // a do-nothing test under src/ must not count as "fails on the original" just because the original src/ lacks it
    edit(inSrc, 'src/money.js', 'return Math.round(amount * 100) / 100', EXACT)
    put(inSrc, 'src/test/noop.test.js', "import test from 'node:test'\ntest('noop', () => {})\n")
    failing(L2, inSrc, /passes on the original src\//)

    const gone = fixture(L2)   // callers that no longer use the shared helper, which has no roundMoney any more
    const inline = (expr) => `Number(Math.round(\`\${${expr}}e2\`) + 'e-2')`
    put(gone, 'src/invoice.js', `export const lineTotal = (quantity, unitPrice) => ${inline('quantity * unitPrice')}\n`)
    put(gone, 'src/refund.js', `export const refundAmount = (paid, percent) => ${inline('(paid * percent) / 100')}\n`)
    put(gone, 'src/money.js', 'export const other = 1\n')
    failing(L2, gone, /src\/money\.js no longer exports roundMoney/)

    put(gone, 'src/invoice.js', 'export const lineTotal =')
    failing(L2, gone, /src\/invoice\.js does not load/)
})

test('L3: needs working quoted CSV, the default output kept, the suite green and zero dependencies', () => {
    const dir = fixture(L3)
    failing(L3, dir, /--csv printed/)

    put(dir, 'bin/report.js', CSV_CLI.replace('(/[",\\n]/.test(v)', '(false'))   // no quoting
    failing(L3, dir, /--csv printed/)

    fixL3(dir)
    passing(L3, dir)

    edit(dir, 'bin/report.js', 'process.argv.includes(\'--csv\') ? csv(rows) : formatText(rows)', 'csv(rows)')
    failing(L3, dir, /the default output changed/)
    fixL3(dir)

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    put(dir, 'package.json', JSON.stringify({ ...pkg, dependencies: { 'csv-stringify': '^6.0.0' } }))
    failing(L3, dir, /dependencies were added: csv-stringify/)

    const good = () => { const d = fixture(L3); fixL3(d); return d }   // a correct fix, then one rejected condition each
    let bad = good(); put(bad, 'bin/report.js', "throw new Error('boom')\n")
    failing(L3, bad, /bin\/report\.js exits 1: /)
    bad = good(); put(bad, 'package.json', 'not json')
    failing(L3, bad, /package\.json is missing or not JSON/)
    bad = good(); mkdirSync(join(bad, 'node_modules'))
    failing(L3, bad, /node_modules exists/)
    bad = good(); put(bad, 'spec/broken.spec.js', "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('broken', () => assert.equal(1, 2))\n")
    failing(L3, bad, /the repo's own tests fail/)
})

test('L4: needs file:line on the traversal bug and no edit, commit or stray file', () => {
    const dir = fixture(L4)
    failing(L4, dir, /no line of the answer names src\/files\.js:7/, 'There is no bug.')
    failing(L4, dir, /no line of the answer names/, 'src/files.js:3 and src/handler.js:7 look odd')
    failing(L4, dir, /no line of the answer names/, 'src/handler.js:7 path traversal')
    failing(L4, dir, /no line of the answer names/, 'src/files.js:9 readFileSync throws EISDIR when the name is a directory')   // a real line, a different bug
    failing(L4, dir, /no line of the answer names/, 'src/files.js:1-10 has a bug')   // too broad, no traversal
    failing(L4, dir, /no line of the answer names/, 'src/files.js:1-10 contains a path traversal')   // too broad even with the word
    failing(L4, dir, /no line of the answer names/, 'src/files.js:5-8: path traversal')   // starts before the bug
    failing(L4, dir, /no line of the answer names/, 'src/files.js:9 path traversal')   // the read, not the join
    failing(L4, dir, /no line of the answer names/, 'src/files.js:7 is wrong.\nThe path traversal is somewhere else.')   // the cite and the cause must share a line
    for (const answer of ['src/files.js:7 join(root, name) allows ../', 'bug at `src/files.js:L7`: path traversal', 'src/files.js:7-9: the name can escape the upload root', 'Found it: src/files.js:7–9 is a directory traversal', '- src/handler.js:5 nit\n- src/files.js:7 traversal via ..']) passing(L4, dir, answer)
    failing(L4, dir, /no line of the answer names/, 'src/files.js:7 looks fine...')   // an ellipsis is not a ../
    failing(L4, dir, /no answer was captured/)

    put(dir, 'notes.md', 'x')
    failing(L4, dir, /files were changed: \?\? notes\.md/, 'src/files.js:7')
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'more')
    failing(L4, dir, /a commit was made/, 'src/files.js:7')
})

test('every scenario ships a repo, a prompt and a check, and no dependency or node_modules', () => {
    const ids = readdirSync(SCEN).sort()
    assert.equal(ids.length, 15, 'four original and eleven new scenarios')
    for (const n of [L1, L2, L3, L4]) assert.ok(ids.includes(n), n)
    for (const id of ids) {
        for (const f of ['prompt.md', 'check.mjs', 'repo/package.json']) assert.ok(existsSync(join(SCEN, id, f)), `${id}/${f}`)
        assert.ok(!existsSync(join(SCEN, id, 'repo/node_modules')))
        const pkg = JSON.parse(readFileSync(join(SCEN, id, 'repo/package.json'), 'utf8'))
        for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) assert.equal(pkg[k], undefined, `${id} ${k}`)
    }
})

// ---- the harness, with fake claude / codex executables on PATH ----

const FAKE = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2), name = process.argv[1].split('/').pop()
if (args.includes('--version')) { console.log(name === 'claude' ? '9.9.9 (Claude Code)' : 'codex-cli 9.9.9'); process.exit(0) }
if (args.includes('--help')) { console.log('--plugin-dir'); process.exit(0) }
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ name, args, stdin: readFileSync(0, 'utf8'), cwd: process.cwd(), tf: existsSync('.ticketflow/manifest.json'), home:process.env.HOME, codex_home:process.env.CODEX_HOME, secret:process.env.OPENAI_API_KEY ?? null }) + '\\n')
if (name === 'codex' && args[0] === 'plugin') {
    if (args[1] === 'marketplace' && args[2] === 'add') { console.log(JSON.stringify({marketplaceName:'ticketflow-benchmark'})); process.exit(0) }
    if (args[1] === 'add') { console.log(JSON.stringify({name:args[2].split('@')[0],marketplaceName:'ticketflow-benchmark'})); process.exit(0) }
    if (args[1] === 'list') { const n = process.env.FAKE_PLUGIN_NAME || 'ponytail'; console.log(JSON.stringify({installed:[{name:n,marketplaceName:'ticketflow-benchmark',installed:true,enabled:process.env.FAKE_PLUGIN_DISABLED!=='1'}]})); process.exit(0) }
    process.exit(2)
}
const edit = (f, from, to) => writeFileSync(f, readFileSync(f, 'utf8').replace(from, to))
if (process.env.FAKE_FIX) edit('src/messages.js', 'recieve', 'receive')
if (process.env.FAKE_DEP) edit('package.json', '"private"', '"dependencies":{"left-pad":"1"},"private"')
if (process.env.FAKE_NPM) { mkdirSync('node_modules/left-pad', { recursive: true }); writeFileSync('node_modules/left-pad/index.js', 'x\\n'); writeFileSync('package-lock.json', '{}\\n') }
if (process.env.FAKE_CREATE_AUTH && name === 'codex' && args[0] === 'exec') writeFileSync(join(process.env.CODEX_HOME, 'credentials.json'), 'generated')
const o = args.indexOf('-o')
if (o >= 0) writeFileSync(args[o + 1], process.env.FAKE_ANSWER ?? '')
console.log(process.env.FAKE_OUT)
process.exit(+(process.env.FAKE_EXIT ?? 0))
`
const CLAUDE_OUT = (result = 'done') => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 4, total_cost_usd: 0.42, result, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30 }, modelUsage: { 'fake-model': {} } })
const CODEX_OUT = ['{"type":"thread.started","thread_id":"t"}', 'not json', '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":60,"output_tokens":7}}', '{"type":"turn.completed","usage":{"input_tokens":50,"cached_input_tokens":40,"output_tokens":3}}'].join('\n')

function sandbox() {
    const bin = tempDir('bin-'), tmp = tempDir('tmp-')
    for (const n of ['claude', 'codex']) { writeFileSync(join(bin, n), FAKE.replace('#!/usr/bin/env node', `#!${process.execPath}`)); chmodSync(join(bin, n), 0o755) }
    const log = join(bin, 'fake.log')
    const run = (args, env = {}, path = `${bin}:${process.env.PATH}`) => {
        const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', env: { ...process.env, PATH: path, TMPDIR: tmp, FAKE_LOG: log, FAKE_OUT: CLAUDE_OUT(), ...env } })
        const row = r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null
        return { ...r, row, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [] }
    }
    return { bin, tmp, run, workdirs: () => readdirSync(tmp) }
}
const sha = git(ROOT, 'rev-parse', 'HEAD')

test('claude, ticketflow arm: installs TicketFlow like init does, runs the prompt, records every field', () => {
    const { tmp, run } = sandbox(), out = join(tmp, 'rows.jsonl')
    const r = run([L1, '--agent', 'claude', '--arm', 'ticketflow', '--out', out], { FAKE_FIX: '1' })
    assert.equal(r.status, 0, r.stderr)
    const { row, calls } = r
    assert.equal(row.scenario, L1)
    assert.equal(row.agent, 'claude'); assert.equal(row.agent_version, '9.9.9 (Claude Code)'); assert.equal(row.model, 'fake-model'); assert.equal(row.arm, 'ticketflow')
    assert.equal(row.ticketflow_sha, sha); assert.equal(row.eval_sha, sha)
    assert.match(row.eval_fingerprint, /^[0-9a-f]{64}$/); assert.equal(row.evaluation_mode, 'non-adversarial')
    assert.equal(typeof row.ticketflow_dirty, 'boolean'); assert.equal(row.ticketflow_version, readFileSync(join(ROOT, 'VERSION'), 'utf8').trim())
    assert.deepEqual(row.check, { pass: true, why: row.check.why }); assert.match(row.check.why, /^PASS/)
    assert.deepEqual(row.diff, { added: 1, removed: 1, files: ['src/messages.js'] })   // the install is in the base commit, not in the diff
    assert.equal(row.deps_added, 0)
    assert.equal(row.turns, 4); assert.equal(row.cost_usd, 0.42); assert.deepEqual(row.tokens, { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30 })
    assert.equal(row.agent_exit, 0); assert.equal(row.descendants, 'unknown'); assert.equal(typeof row.wall_s, 'number'); assert.match(row.date, /^\d{4}-\d\d-\d\dT/)
    assert.equal(readFileSync(out, 'utf8'), `${JSON.stringify(row)}\n`, '--out gets the same one-line row')

    assert.equal(calls.length, 1)
    const prompt = readFileSync(join(SCEN, L1, 'prompt.md'), 'utf8')
    assert.deepEqual(calls[0].args.slice(0, 8), ['-p', prompt, '--output-format', 'json', '--no-session-persistence', '--setting-sources', 'project,local', '--allowedTools'])   // no user-level settings or plugins
    assert.match(calls[0].args[8], /Edit/); assert.doesNotMatch(calls[0].args.join(' '), /--dangerously|bypassPermissions/)
    assert.equal(calls[0].stdin, '', 'the prompt is the argument, stdin is empty (a piped stdin would be appended to it)')
    const repo = join(row.workdir, 'repo')
    assert.equal(realpathSync(calls[0].cwd), realpathSync(repo)); assert.ok(calls[0].tf, 'installed before the agent started')
    for (const p of ['.ticketflow/manifest.json', '.ticketflow/scripts/merge.mjs', '.claude/skills/implement-ticket/SKILL.md', 'AGENTS.md']) assert.ok(existsSync(join(repo, p)), p)
    assert.ok(!existsSync(join(repo, '.agents')), 'only the chosen agent\'s stubs')
    assert.ok(!existsSync(join(repo, 'benchmarks')), 'maintainer benchmarks are never installed')
    assert.ok(!existsSync(join(repo, '.ticketflow/benchmarks')), 'benchmark scripts are not part of the runtime')
    assert.equal(JSON.parse(readFileSync(join(repo, '.ticketflow/config.json'), 'utf8')).agents[0], 'claude')
    assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '1')
    assert.match(readFileSync(join(row.workdir, 'agent.out'), 'utf8'), /"num_turns":4/, 'the raw agent output is kept')
})

test('bare arm installs nothing; a failed hidden check is recorded as fail (exit 1) and rows append; deps and a failing agent are recorded', () => {
    const { tmp, run } = sandbox(), out = join(tmp, 'rows.jsonl')
    let r = run([L1, '--agent', 'claude', '--arm', 'bare', '--out', out], { FAKE_FIX: '1' })
    assert.equal(r.status, 0, r.stderr)
    const repo = join(r.row.workdir, 'repo')
    assert.equal(r.row.arm, 'bare'); assert.deepEqual([r.row.ticketflow_sha, r.row.ticketflow_dirty, r.row.ticketflow_version], [null, null, null]); assert.equal(r.row.eval_sha, sha)
    assert.deepEqual(readdirSync(repo).sort(), ['package.json', 'spec', 'src'].concat('.git').sort())
    assert.ok(!r.calls[0].tf)

    r = run([L1, '--agent', 'claude', '--arm', 'bare', '--out', out], { FAKE_DEP: '1', FAKE_NPM: '1', FAKE_EXIT: '3' })
    assert.equal(r.status, 1, 'the check failed')
    assert.equal(r.row.check.pass, false); assert.match(r.row.check.why, /^FAIL: messages are .*recieve/)
    assert.equal(r.row.deps_added, 1); assert.deepEqual(r.row.diff.files, ['package.json'], 'npm install output (node_modules, the lockfile) is not counted in the diff')
    assert.equal(r.row.agent_exit, 3)
    const rows = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    assert.deepEqual(rows.map((x) => x.check.pass), [true, false], 'the failure is not dropped and the first row is kept')
})

test('codex: exec --json in the workspace sandbox, tokens summed over turns, answer from -o, scenario by prefix', () => {
    const { run } = sandbox()
    const r = run(['L4', '--agent', 'codex', '--arm', 'ticketflow', '--model', 'gpt-test'], { FAKE_OUT: CODEX_OUT, FAKE_ANSWER: 'src/files.js:7 path traversal' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(r.row.scenario, L4); assert.equal(r.row.agent, 'codex'); assert.equal(r.row.agent_version, 'codex-cli 9.9.9'); assert.equal(r.row.model, 'gpt-test')
    assert.equal(r.row.check.pass, true)
    assert.deepEqual(r.row.tokens, { input_tokens: 150, cached_input_tokens: 100, output_tokens: 10 })
    assert.equal(r.row.turns, null); assert.equal(r.row.cost_usd, null); assert.equal(r.row.descendants, 'unknown')
    const { args, stdin } = r.calls[0]
    assert.deepEqual(args.slice(0, 6), ['exec', '--json', '--ignore-user-config', '--sandbox', 'workspace-write', '-C'])   // no user-level config
    assert.equal(args.at(-1), '-'); assert.equal(args[args.indexOf('-m') + 1], 'gpt-test')
    assert.equal(stdin, readFileSync(join(SCEN, L4, 'prompt.md'), 'utf8'))
    assert.ok(existsSync(join(r.row.workdir, 'repo/.agents/skills/implement-ticket/SKILL.md')) && !existsSync(join(r.row.workdir, 'repo/.claude/skills')))
})

test('claude answer comes from the result; unreadable output is recorded as nulls, not invented', () => {
    const { run } = sandbox()
    let r = run([L4, '--agent', 'claude', '--arm', 'bare'], { FAKE_OUT: JSON.stringify([{ type: 'system' }, JSON.parse(CLAUDE_OUT('Bug: src/files.js:7 path traversal'))]) })
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.row.check.pass, true)
    r = run([L4, '--agent', 'claude', '--arm', 'bare'], { FAKE_OUT: 'Error: not logged in', FAKE_EXIT: '1' })
    assert.equal(r.status, 1)
    assert.deepEqual([r.row.turns, r.row.cost_usd, r.row.tokens, r.row.model], [null, null, null, null]); assert.equal(r.row.agent_exit, 1)
})

test('--source installs another checkout (an older tag) and records its revision, not this one\'s', () => {
    const { run } = sandbox(), src = tempDir('src-')
    for (const p of ['core', 'skills', 'practices']) if (existsSync(join(ROOT, p))) cpSync(join(ROOT, p), join(src, p), { recursive: true })
    writeFileSync(join(src, 'VERSION'), '0.0.1\n')
    git(src, 'init', '-q', '-b', 'main'); git(src, 'remote', 'add', 'origin', 'https://example.invalid/ticketflow.git'); git(src, 'add', '-A'); git(src, 'commit', '-qm', 'src')
    const r = run([L1, '--agent', 'claude', '--arm', 'ticketflow', '--source', src], { FAKE_FIX: '1' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(r.row.ticketflow_sha, git(src, 'rev-parse', 'HEAD')); assert.equal(r.row.ticketflow_version, '0.0.1'); assert.equal(r.row.ticketflow_dirty, false); assert.equal(r.row.eval_sha, sha)
    assert.equal(JSON.parse(readFileSync(join(r.row.workdir, 'repo/.ticketflow/manifest.json'), 'utf8')).version, '0.0.1')
    // the harness's own result file inside the source checkout is not a change to it, also on a repeated run; anything else is
    mkdirSync(join(src, 'results'))   // as the documented commands do
    for (let i = 0; i < 2; i++) assert.equal(run([L1, '--agent', 'claude', '--arm', 'ticketflow', '--source', src, '--out', join(src, 'results/rows.jsonl')], { FAKE_FIX: '1' }).row.ticketflow_dirty, false)
    writeFileSync(join(src, 'core/stray.txt'), 'x\n')
    assert.equal(run([L1, '--agent', 'claude', '--arm', 'ticketflow', '--source', src, '--out', join(src, 'results/rows.jsonl')], { FAKE_FIX: '1' }).row.ticketflow_dirty, true)
    const bad = run([L1, '--agent', 'claude', '--arm', 'ticketflow', '--source', tempDir('empty-')])
    assert.equal(bad.status, 2); assert.match(bad.stderr, /is not a ticketflow checkout/)
})

test('external frameworks load from clean native Claude plugin checkouts, not copied skill imitations', () => {
    const { run } = sandbox(), src = tempDir('plugin-')
    mkdirSync(join(src, '.claude-plugin'), { recursive: true })
    writeFileSync(join(src, '.claude-plugin/plugin.json'), '{"name":"ponytail"}')
    git(src, 'init', '-q', '-b', 'main'); git(src, 'add', '-A'); git(src, 'commit', '-qm', 'pinned'); git(src, 'remote', 'add', 'origin', 'https://github.com/DietrichGebert/ponytail.git')
    const r = run([L1, '--agent', 'claude', '--arm', 'ponytail', '--source', src, '--model', 'pinned-model', '--rep', '2', '--label', 'ponytail'], { FAKE_FIX: '1' })
    assert.equal(r.status, 0, r.stdout+r.stderr)
    assert.equal(r.row.plugin_sha, git(src, 'rev-parse', 'HEAD'))
    assert.equal(r.row.ticketflow_sha, null)
    assert.equal(r.row.repeat, 2)
    assert.equal(r.row.requested_model, 'pinned-model')
    assert.equal(r.row.variant, 'ponytail')
    assert.match(r.row.plugin_native, /bootstrap not independently verified/)
    assert.deepEqual(r.calls[0].args.slice(-2), ['--plugin-dir', src])
    assert.equal(run([L1, '--agent', 'codex', '--arm', 'ponytail', '--source', src]).status, 2)
    writeFileSync(join(src, 'stray.txt'), 'uncommitted')
    const dirty = run([L1, '--agent', 'claude', '--arm', 'ponytail', '--source', src])
    assert.equal(dirty.status, 2)
    assert.match(dirty.stderr, /clean pinned plugin checkout/)
})

test('Codex native competitor arm installs exactly one plugin in a clean isolated profile and checks activation', () => {
    const { run } = sandbox(), src = tempDir('codex-plugin-')
    mkdirSync(join(src, '.codex-plugin'), { recursive: true })
    writeFileSync(join(src, '.codex-plugin/plugin.json'), '{"name":"ponytail"}')
    git(src, 'init', '-q', '-b', 'main'); git(src, 'add', '-A'); git(src, 'commit', '-qm', 'pinned'); git(src, 'remote', 'add', 'origin', 'https://github.com/DietrichGebert/ponytail.git')
    const authDir = tempDir('codex-auth-')
    writeFileSync(join(authDir, 'auth.json'), '{"fake":"login"}')
    const r = run([L1, '--agent', 'codex', '--arm', 'ponytail', '--source', src, '--model', 'gpt-test'], { FAKE_FIX: '1', FAKE_CREATE_AUTH: '1', CODEX_HOME: authDir, OPENAI_API_KEY: 'should-not-reach-cli' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.deepEqual(r.calls.filter((c) => c.args[0] === 'plugin').map((c) => c.args.slice(0, 3)),
        [['plugin','marketplace','add'], ['plugin','add','ponytail@ticketflow-benchmark'], ['plugin','list','--json']])
    const exec = r.calls.find((c) => c.args[0] === 'exec')
    assert.ok(exec, 'the coding session ran after plugin verification')
    assert.equal(exec.secret, null, 'credential-bearing environment variables are not passed to the agent')
    assert.ok(!exec.args.includes('--ignore-user-config'), 'Codex must load the isolated profile with its installed plugin')
    assert.equal(exec.codex_home, join(r.row.workdir, 'home/.codex'))
    assert.equal(exec.home, join(r.row.workdir, 'home'))
    assert.ok(existsSync(join(r.row.workdir, 'marketplace/plugins/ponytail/.codex-plugin/plugin.json')))
    assert.ok(!existsSync(join(exec.codex_home, 'auth.json')), 'temporary authorization is never retained')
    assert.ok(!existsSync(join(exec.codex_home, 'credentials.json')), 'generated credential state is never retained')
    assert.equal(readFileSync(join(authDir, 'auth.json'), 'utf8'), '{"fake":"login"}', 'original credentials are untouched')
    assert.match(r.row.plugin_native, /installed and enabled.*bootstrap not independently verified/)
    assert.equal(r.row.plugin_sha, git(src, 'rev-parse', 'HEAD'))
    assert.equal(r.row.ticketflow_sha, null)

    const { run: runDisabled } = sandbox()
    const disabled = runDisabled([L1, '--agent', 'codex', '--arm', 'ponytail', '--source', src], { FAKE_PLUGIN_DISABLED:'1' })
    assert.equal(disabled.status, 2)
    assert.match(disabled.stderr, /not exclusively installed and enabled/)
    assert.ok(!disabled.calls.some((c) => c.args[0] === 'exec'), 'no paid session if plugin is disabled')
    const invalid = run([L1, '--agent', 'codex', '--arm', 'ponytail', '--source', tempDir('empty-plugin-')])
    assert.equal(invalid.status, 2)
})

test('Codex bare control loads no plugin and uses an isolated home', () => {
    const { run } = sandbox()
    const r = run([L1, '--agent', 'codex', '--arm', 'bare'], { FAKE_FIX: '1' })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!r.calls.some((c) => c.args[0] === 'plugin'))
    const exec = r.calls[0]
    assert.ok(exec.args.includes('--ignore-user-config'))
    assert.equal(exec.codex_home, join(r.row.workdir, 'home/.codex'))
    assert.ok(!existsSync(join(r.row.workdir, 'marketplace')))
})

test('scenario prefixes are rejected when they match more than one fixture', () => {
    const dir = tempDir('ambiguous-scenarios-')
    mkdirSync(join(dir, 'L1-first')); mkdirSync(join(dir, 'L1-second'))
    assert.throws(() => resolveScenario(dir, 'L1'), /ambiguous scenario L1/)
})

test('a bad scenario, agent or arm, a missing option or a missing CLI exits 2 before any run', () => {
    const { tmp, run, workdirs } = sandbox()
    const bad = (args, why, path) => {
        const r = run(args, {}, path)
        assert.equal(r.status, 2, `${args.join(' ')}\n${r.stdout}${r.stderr}`); assert.match(r.stderr, why); assert.equal(r.stdout, ''); assert.equal(r.calls.length, 0)
        assert.deepEqual(workdirs(), [], 'no work directory was made')
    }
    bad(['L99', '--agent', 'claude', '--arm', 'bare'], /agent-eval: unknown scenario L99/)
    bad(['../L1-trivial-copy', '--agent', 'claude', '--arm', 'bare'], /unknown scenario/)
    bad(['L', '--agent', 'claude', '--arm', 'bare'], /unknown scenario/)
    bad([L1, '--agent', 'gemini', '--arm', 'bare'], /usage: agent-eval/)
    bad([L1, '--agent', 'claude', '--arm', 'both'], /usage: agent-eval/)
    bad([L1, '--agent', 'claude'], /usage: agent-eval/)
    bad([], /usage: agent-eval/)
    bad([L1, '--agent', 'claude', '--arm', 'bare', '--out', join(tmp, 'missing', 'rows.jsonl')], /cannot be written/)
    bad([L1, '--agent', 'claude', '--arm', 'bare', '--out', tmp], /cannot be written/)   // a directory: refused before the paid run, not at the append after it
    bad([L1, '--agent', 'claude', '--arm', 'ticketflow', '--source', join(tmp, 'nowhere')], /is not a ticketflow checkout/)
    bad([L1, '--agent', 'claude', '--arm', 'bare'], /claude is not installed/, tmp)   // PATH without any CLI
    bad([L1, '--agent', 'codex', '--arm', 'bare'], /codex is not installed/, tmp)
})
