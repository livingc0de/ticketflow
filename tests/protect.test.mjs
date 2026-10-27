import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { CAN_BYPASS, desiredRuleset, relation } from '../core/lib/protect.mjs'
import { config, fakeGh, seq, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/protect.mjs', import.meta.url).pathname
const R = 'repos/o/r'
const NOT_PROTECTED = { __status: 404, __stderr: 'Branch not protected' }
const repo = (over = {}) => ({ default_branch: 'main', permissions: { admin: true }, allow_merge_commit: true, allow_rebase_merge: true, delete_branch_on_merge: false, ...over })
const standardPr = { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false, allowed_merge_methods: ['squash'] }
const standardChecks = (...contexts) => ({ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false, required_status_checks: contexts.map((context) => ({ context })) } })
const admin = (bypass_mode = 'pull_request') => ({ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode })
/** A ruleset like one an existing repo has: squash/merge/rebase all allowed, the admin bypass "always". */
const old = (over = {}) => ({
    id: 11, name: 'main', target: 'branch', source_type: 'Repository', enforcement: 'active', current_user_can_bypass: 'always',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: { ...standardPr, allowed_merge_methods: ['merge', 'squash', 'rebase'] } }, standardChecks('CI / Gate')],
    bypass_actors: [admin('always')], ...over,
})
const standardRuleset = (over = {}) => ({ ...old(), rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: standardPr }, standardChecks('CI / Gate')], bypass_actors: [admin()], current_user_can_bypass: CAN_BYPASS, ...over })

function run(args, map, over) {
    const dir = tempDir('protect-')
    const gh = fakeGh(dir, {
        [R]: repo(), [`${R}/branches/main`]: { name: 'main' }, [`${R}/branches/main/protection`]: NOT_PROTECTED, [`${R}/rulesets`]: [],
        ...map,
    })
    const r = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir, over)], { encoding: 'utf8', env: gh.env })
    const log = gh.log()
    const method = (c) => c.args[c.args.indexOf('-X') + 1]
    const path = (c) => c.args.find((a, i) => i > 0 && !a.startsWith('-') && c.args[i - 1] !== '-X')
    return {
        ...r, calls: gh.calls(),
        sequence: log.map((c) => `${method(c)} ${path(c).replace(`${R}/`, '').replace(R, 'repo')}`),
        writes: log.filter((c) => method(c) !== 'GET').map((c) => ({ call: `${method(c)} ${path(c).replace(`${R}/`, '').replace(R, 'repo')}`, body: JSON.parse(c.stdin) })),
    }
}
const listed = (...rs) => ({ [`${R}/rulesets`]: rs.map(({ id, name, source_type = 'Repository' }) => ({ id, name, source_type })), ...Object.fromEntries(rs.map((x) => [`${R}/rulesets/${x.id}`, x])) })

test('no ruleset: the plan shows a create, drift exits 1, nothing is written', () => {
    const r = run([], {})
    assert.equal(r.status, 1)
    assert.match(r.stdout, /^ruleset: \(none\) -> create "default branch"$/m)
    assert.match(r.stdout, /ruleset\.bypass\.RepositoryRole:5: \(none\) -> pull_request/)
    assert.doesNotMatch(r.stdout, /settings\.|allowed_merge_methods/)   // the repo's merge methods and branch settings are its own
    assert.deepEqual(r.writes, [])
})

test('an existing ruleset keeps its merge methods, bypass actors and the repo settings; only a missing gate is drift', () => {
    const r = run([], listed(old()))   // all merge methods, the admin bypass "always", merge commits on: all the repo's
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(r.stdout, '')
    const squashOnly = run([], { [R]: repo({ allow_merge_commit: false, allow_rebase_merge: false }), ...listed(standardRuleset()) })
    assert.equal(squashOnly.status, 0, squashOnly.stdout + squashOnly.stderr); assert.equal(squashOnly.stdout, '')
    const noGate = run([], listed(old({ rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: standardPr }, standardChecks('lint')] })))
    assert.equal(noGate.status, 1)
    assert.deepEqual(noGate.stdout.trim().split('\n'), ['ruleset.rules.required_status_checks.required_status_checks: ["lint"] -> ["CI / Gate","lint"]'])
    const noAdmin = run([], listed(old({ bypass_actors: [] })))
    assert.equal(noAdmin.status, 0); assert.match(noAdmin.stderr, /no repository-admin bypass actor: kept as it is/)
    assert.match(r.stderr, /repository-admin bypass is "always", not "pull_request": kept as it is \(the owner decides\)/)
})

test('an extra rule, an extra context, stricter approvals and an extra bypass actor are kept in the body', () => {
    const rs = old({
        rules: [{ type: 'creation' }, { type: 'pull_request', parameters: { ...standardPr, required_approving_review_count: 2 } }, standardChecks('lint')],
        bypass_actors: [{ actor_id: 99, actor_type: 'Team', bypass_mode: 'always' }],
    })
    const r = run(['--apply'], { ...listed(rs), [`PUT ${R}/rulesets/11`]: { id: 11 }, [`${R}/rulesets/11`]: seq(rs, rs) })
    const put = r.writes.find((w) => w.call === 'PUT rulesets/11').body
    assert.deepEqual(put.rules.map((x) => x.type).sort(), ['creation', 'deletion', 'non_fast_forward', 'pull_request', 'required_status_checks'])
    assert.equal(put.rules.find((x) => x.type === 'pull_request').parameters.required_approving_review_count, 2)
    assert.deepEqual(put.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks.map((c) => c.context), ['lint', 'CI / Gate'])
    assert.deepEqual(put.bypass_actors, [{ actor_id: 99, actor_type: 'Team', bypass_mode: 'always' }])   // no admin actor added
    assert.equal(put.name, 'main')
    assert.match(r.stderr, /kept other rules.*creation/); assert.match(r.stderr, /kept 1 other bypass/)
})

test('two rulesets covering the default branch exit 2, listing both; org-level and non-covering ones are ignored', () => {
    const a = old({ id: 11, name: 'one' }), b = old({ id: 12, name: 'two' })
    const r = run([], listed(a, b))
    assert.equal(r.status, 2)
    assert.match(r.stderr, /"one" \(id 11\), "two" \(id 12\)/)
    const org = { id: 20, name: 'org rules', source_type: 'Organization' }
    const tags = old({ id: 13, name: 'tags', conditions: { ref_name: { include: ['refs/tags/*'], exclude: [] } } })
    const ok = run([], { ...listed(a, tags), [`${R}/rulesets`]: [{ id: 11, name: 'one', source_type: 'Repository' }, { id: 13, name: 'tags', source_type: 'Repository' }, org] })
    assert.notEqual(ok.status, 2, ok.stderr)
    assert.match(ok.stdout, /org-level ruleset "org rules" \(not touched\)/)
})

test('--apply: current ruleset printed, then ruleset, read-back, with this exact call order; the repo settings are never written', () => {
    const before = old({ rules: [{ type: 'deletion' }, { type: 'pull_request', parameters: standardPr }, standardChecks('lint')] })
    const r = run(['--apply'], { ...listed(before), [`PUT ${R}/rulesets/11`]: { id: 11 }, [`${R}/rulesets/11`]: seq(before, old({ rules: [{ type: 'deletion' }, { type: 'pull_request', parameters: standardPr }, standardChecks('lint', 'CI / Gate'), { type: 'non_fast_forward' }] })) })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.sequence, ['GET repo', 'GET branches/main', 'GET rulesets?per_page=100', 'GET rulesets/11', 'GET branches/main/protection', 'PUT rulesets/11', 'GET rulesets/11'])
    assert.ok(r.stdout.indexOf('current ruleset (rollback') > r.stdout.indexOf('ruleset.rules'))
    assert.match(r.stdout, /"name": "main"/)
    const create = run(['--apply'], { [`POST ${R}/rulesets`]: { id: 30 }, [`${R}/rulesets/30`]: standardRuleset({ id: 30, rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: { ...standardPr, allowed_merge_methods: undefined } }, standardChecks('CI / Gate')] }) })
    assert.equal(create.status, 0, create.stderr)
    assert.deepEqual(create.writes.map((w) => w.call), ['POST rulesets'])
    const body = create.writes[0].body
    assert.equal(body.name, 'default branch')
    assert.deepEqual(body.conditions, { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } })
    assert.deepEqual(body.bypass_actors, [admin()])
    assert.ok(!('allowed_merge_methods' in body.rules.find((x) => x.type === 'pull_request').parameters))
})

test('a read-back that differs, or a bypass the admin does not have, exits 1 and keeps the classic protection', () => {
    const classic = { required_status_checks: { contexts: ['CI / Gate'] }, enforce_admins: { enabled: false } }
    const noGate = old({ rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: standardPr }, standardChecks('lint')] })
    const base = { ...listed(noGate), [`PUT ${R}/rulesets/11`]: { id: 11 }, [`${R}/branches/main/protection`]: classic }
    const differs = run(['--apply', '--migrate-classic'], { ...base, [`${R}/rulesets/11`]: seq(noGate, noGate) })
    assert.equal(differs.status, 1); assert.match(differs.stderr, /read-back differs/)
    // the bypass is checked only on a ruleset created here
    const created = { [`POST ${R}/rulesets`]: { id: 30 }, [`${R}/branches/main/protection`]: classic }
    const never = run(['--apply', '--migrate-classic'], { ...created, [`${R}/rulesets/30`]: standardRuleset({ id: 30, current_user_can_bypass: 'never' }) })
    assert.equal(never.status, 1); assert.match(never.stderr, /current_user_can_bypass is never/)
    for (const r of [differs, never]) assert.ok(!r.sequence.some((s) => s.startsWith('DELETE')))
    const existingNever = run(['--apply'], { ...listed(old()), [`PUT ${R}/rulesets/11`]: { id: 11 }, [`${R}/rulesets/11`]: seq(old(), old({ current_user_can_bypass: 'never' })) })
    assert.equal(existingNever.status, 0, existingNever.stderr)
})

test('classic protection is kept without the flag; with it, the contexts join the ruleset and the DELETE comes after the read-back', () => {
    const classic = { required_status_checks: { strict: true, contexts: ['lint'], checks: [{ context: 'lint' }, { context: 'build' }] }, required_pull_request_reviews: { required_approving_review_count: 0 }, enforce_admins: { enabled: true } }
    const map = { ...listed(old()), [`PUT ${R}/rulesets/11`]: { id: 11 }, [`${R}/branches/main/protection`]: classic, [`DELETE ${R}/branches/main/protection`]: null }
    const kept = run(['--apply'], { ...map, [`${R}/rulesets/11`]: seq(old(), old()) })
    assert.equal(kept.status, 0, kept.stderr)
    assert.match(kept.stderr, /classic branch protection .* stays/)
    assert.ok(!kept.sequence.some((s) => s.startsWith('DELETE')))
    const migrated = ['lint', 'build', 'CI / Gate']
    const after = old({ rules: [...old().rules.slice(0, 3), standardChecks(...migrated)] })
    const r = run(['--apply', '--migrate-classic'], { ...map, [`${R}/rulesets/11`]: seq(old(), after) })
    assert.equal(r.status, 0, r.stderr + r.stdout)
    const put = r.writes.find((w) => w.call === 'PUT rulesets/11').body
    assert.deepEqual(put.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks.map((c) => c.context), ['CI / Gate', 'lint', 'build'])
    assert.equal(r.sequence.at(-1), 'DELETE branches/main/protection')
    assert.ok(r.sequence.lastIndexOf('GET rulesets/11') < r.sequence.indexOf('DELETE branches/main/protection'))
})

test('a classic setting the ruleset does not take over exits 1 with zero writes', () => {
    for (const bad of [{ required_pull_request_reviews: { required_approving_review_count: 1 } }, { required_signatures: { enabled: true } }, { required_linear_history: { enabled: true } },
        { required_conversation_resolution: { enabled: true } }, { lock_branch: { enabled: true } }, { restrictions: { users: [] } }]) {
        const r = run(['--apply', '--migrate-classic'], { ...listed(old()), [`${R}/branches/main/protection`]: { required_status_checks: { contexts: [] }, ...bad } })
        assert.equal(r.status, 1, JSON.stringify(bad)); assert.deepEqual(r.writes, []); assert.match(r.stderr, /does not take over/)
    }
})

test('an empty repo exits 1; --apply without admin and a wrong default branch exit 2; both before any write', () => {
    const empty = run([], { [`${R}/branches/main`]: { __status: 404, __stderr: 'Branch not found' } })
    assert.equal(empty.status, 1); assert.match(empty.stderr, /push the initial commit first/)
    const noAdmin = run(['--apply'], { [R]: repo({ permissions: { admin: false } }) })
    assert.equal(noAdmin.status, 2); assert.deepEqual(noAdmin.writes, []); assert.match(noAdmin.stderr, /admin rights/)
    assert.equal(run([], { [R]: repo({ permissions: { admin: false } }) }).status, 1)   // plan mode needs no admin right
    const other = run([], { [R]: repo({ default_branch: 'trunk' }) })
    assert.equal(other.status, 2)
})

test("GitHub's plan-upgrade message is shown", () => {
    const r = run([], { [`${R}/rulesets`]: { __status: 403, __stderr: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' } })
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Upgrade to GitHub Pro/)
})

test('arguments in another order or unknown exit 2 before any call', () => {
    for (const a of [['--migrate-classic', '--apply'], ['--migrate-classic'], ['--apply', 'x'], ['--nope']]) {
        const r = run(a, {})
        assert.equal(r.status, 2, a.join(' ')); assert.deepEqual(r.calls, [])
    }
})

test('desiredRuleset is idempotent: applying it to its own output changes nothing', () => {
    const { body } = desiredRuleset(null, config())
    assert.deepEqual(desiredRuleset({ ...body, id: 1 }, config()).body, body)
})

test('parameters GitHub adds to a stored ruleset do not count as drift', () => {
    const stored = standardRuleset()
    stored.rules.find((r) => r.type === 'pull_request').parameters.required_reviewers = []
    stored.rules.find((r) => r.type === 'pull_request').parameters.require_extra_approval_for_unattributed_changes = true
    const r = run([], { [R]: repo(), ...listed(stored) })
    assert.equal(r.status, 0, r.stdout)
})

test('a ruleset is updated in place only when it names just the default branch; a broad one exits 2', () => {
    const cond = (include, exclude = []) => ({ ref_name: { include, exclude } })
    const rel = (conditions, over = {}) => relation({ target: 'branch', conditions, ...over }, 'main')
    assert.equal(rel(cond(['~DEFAULT_BRANCH'])), 'exact')
    assert.equal(rel(cond(['refs/heads/main'])), 'exact')
    assert.equal(rel(cond(['~ALL'])), 'broad')
    assert.equal(rel(cond(['~DEFAULT_BRANCH', 'refs/heads/release/*'])), 'broad')
    assert.equal(rel(cond(['refs/heads/*'])), 'broad')
    assert.equal(rel(cond(['refs/heads/ma*'])), 'broad')
    assert.equal(rel(cond(['~DEFAULT_BRANCH'], ['refs/heads/docs'])), 'broad')
    assert.equal(rel(cond(['~ALL'], ['refs/heads/main'])), null)   // excluded: it does not apply to main
    assert.equal(rel(cond(['refs/heads/release/*'])), null)
    assert.equal(relation({ target: 'branch', conditions: cond(['refs/heads/rel*']) }, 'release/1'), null)   // * does not cross a slash
    assert.equal(relation({ target: 'branch', conditions: cond(['refs/heads/release/**']) }, 'release/1'), 'broad')
    assert.equal(rel(cond(['refs/tags/*'])), null)
    assert.equal(rel(cond(['~DEFAULT_BRANCH']), { target: 'tag' }), null)
    const broad = run(['--apply'], listed(old({ conditions: cond(['~ALL']) })))
    assert.equal(broad.status, 2); assert.deepEqual(broad.writes, []); assert.match(broad.stderr, /spread/)
    const excluded = run([], listed(old({ conditions: cond(['~ALL'], ['refs/heads/main']) })))
    assert.match(excluded.stdout, /create "default branch"/)   // that ruleset is not protecting main: a new one is planned
})

test('a disabled ruleset and a changed condition are drift', () => {
    assert.match(run([], { [R]: repo(), ...listed(standardRuleset({ enforcement: 'evaluate' })) }).stdout, /ruleset\.enforcement: evaluate -> active/)
    const r = run([], { [R]: repo(), ...listed(standardRuleset()) })
    assert.equal(r.status, 0)
})

test('classic: code owner reviews block; an app-bound check keeps its app; admin enforcement warns; the rollback copy is printed before the DELETE', () => {
    const blocked = run(['--apply', '--migrate-classic'], { ...listed(old()), [`${R}/branches/main/protection`]: { required_pull_request_reviews: { require_code_owner_reviews: true } } })
    assert.equal(blocked.status, 1); assert.match(blocked.stderr, /code owner reviews/)
    const classic = { required_status_checks: { contexts: ['lint', 'build'], checks: [{ context: 'lint', app_id: 123 }, { context: 'build', app_id: null }] }, enforce_admins: { enabled: true } }
    const after = old({ rules: [...old().rules.slice(0, 3), standardChecks('CI / Gate', 'lint', 'build')] })
    const r = run(['--apply', '--migrate-classic'], { ...listed(old()), [`PUT ${R}/rulesets/11`]: { id: 11 }, [`${R}/rulesets/11`]: seq(old(), after), [`${R}/branches/main/protection`]: classic, [`DELETE ${R}/branches/main/protection`]: null })
    assert.equal(r.status, 0, r.stderr)
    const checks = r.writes.find((w) => w.call === 'PUT rulesets/11').body.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks
    assert.deepEqual(checks, [{ context: 'CI / Gate' }, { context: 'lint', integration_id: 123 }, { context: 'build' }])
    assert.match(r.stderr, /applies to admins/)
    assert.ok(r.stdout.indexOf('rollback: PUT repos/o/r/branches/main/protection') > 0)
})

test('a new ruleset passes the read-back when GitHub returns the conditions keys in its own order', () => {
    const stored = standardRuleset({ id: 30, conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } } })
    const r = run(['--apply'], { [`POST ${R}/rulesets`]: { id: 30 }, [`PATCH ${R}`]: {}, [`${R}/rulesets/30`]: stored, [R]: seq(repo(), repo()) })
    assert.equal(r.status, 0, r.stderr)
    const changed = run([], { [R]: repo(), ...listed(standardRuleset({ conditions: { ref_name: { include: ['~DEFAULT_BRANCH', 'refs/heads/x'], exclude: [] } } })) })
    assert.equal(changed.status, 2)   // it is now broad
})

const ctxs = (body) => body.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks.map((c) => c.context)
const withChecks = (...c) => old({ rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: standardPr }, standardChecks(...c)], bypass_actors: [admin()], current_user_can_bypass: CAN_BYPASS })
const applyMap = (before, after) => ({ ...listed(before), [`PATCH ${R}`]: {}, [`PUT ${R}/rulesets/11`]: { id: 11 }, [`${R}/rulesets/11`]: seq(before, after), [R]: seq(repo(), repo()) })

test('--replace-context: the plan shows the drop with zero writes; --apply ends with exactly gate.context; other contexts are kept', () => {
    const plan = run(['--replace-context', 'ci/gate'], { [R]: repo(), ...listed(withChecks('ci/gate')) })
    assert.equal(plan.status, 1); assert.match(plan.stdout, /required_status_checks: \["ci\/gate"\] -> \["CI \/ Gate"\]/); assert.deepEqual(plan.writes, [])
    const r = run(['--apply', '--replace-context', 'ci/gate'], applyMap(withChecks('ci/gate'), standardRuleset()))
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(ctxs(r.writes.find((w) => w.call === 'PUT rulesets/11').body), ['CI / Gate'])
    const kept = run(['--apply', '--replace-context', 'CI / Old'], applyMap(withChecks('lint', 'CI / Old'), withChecks('lint', 'CI / Gate')))
    assert.equal(kept.status, 0, kept.stderr)
    assert.deepEqual(ctxs(kept.writes.find((w) => w.call === 'PUT rulesets/11').body), ['lint', 'CI / Gate'])
})

test('--replace-context: a read-back that still requires <old> exits 1; without the flag nothing is removed', () => {
    const left = run(['--apply', '--replace-context', 'ci/gate'], applyMap(withChecks('ci/gate'), withChecks('CI / Gate', 'ci/gate')))
    assert.equal(left.status, 1); assert.match(left.stderr, /read-back differs/)
    const plain = run(['--apply'], applyMap(withChecks('ci/gate'), withChecks('ci/gate', 'CI / Gate')))
    assert.equal(plain.status, 0, plain.stderr)
    assert.deepEqual(ctxs(plain.writes.find((w) => w.call === 'PUT rulesets/11').body), ['ci/gate', 'CI / Gate'])
})

test('--replace-context refusals exit 2 before any call: the gate itself, a misplaced, empty, missing, repeated or = flag, --config not last', () => {
    for (const a of [['--replace-context', 'CI / Gate'], ['--replace-context', 'x', '--apply'], ['--replace-context', ''], ['--replace-context'],
        ['--apply', '--replace-context', 'a', '--replace-context', 'b'], ['--replace-context=x'], ['--config', 'x', '--apply'], ['--migrate-classic', '--replace-context', 'x']]) {
        const r = run(a, {})
        assert.equal(r.status, 2, a.join(' ')); assert.deepEqual(r.calls, [], a.join(' '))
    }
    const ok = run(['--apply', '--migrate-classic', '--replace-context', 'ci/gate'], {})
    assert.doesNotMatch(ok.stderr, /usage:/); assert.ok(ok.calls.length > 0)
})

test('--replace-context with classic protection: refused without --migrate-classic (zero writes); with it the classic <old> is dropped too', () => {
    const classic = { required_status_checks: { strict: true, contexts: ['ci/gate', 'lint'] }, required_pull_request_reviews: { required_approving_review_count: 0 }, enforce_admins: { enabled: false } }
    const refused = run(['--apply', '--replace-context', 'ci/gate'], { ...listed(withChecks('ci/gate')), [`${R}/branches/main/protection`]: classic })
    assert.equal(refused.status, 1); assert.deepEqual(refused.writes, []); assert.match(refused.stderr, /also requires "ci\/gate"/)
    const plan = run(['--replace-context', 'ci/gate'], { ...listed(withChecks('ci/gate')), [`${R}/branches/main/protection`]: classic })
    assert.equal(plan.status, 1); assert.deepEqual(plan.writes, []); assert.match(plan.stderr, /also requires "ci\/gate"/); assert.match(plan.stdout, /-> \["CI \/ Gate"\]/)
    const map = { ...applyMap(withChecks('ci/gate'), withChecks('CI / Gate', 'lint')), [`${R}/branches/main/protection`]: classic, [`DELETE ${R}/branches/main/protection`]: null }
    const r = run(['--apply', '--migrate-classic', '--replace-context', 'ci/gate'], map)
    assert.equal(r.status, 0, r.stderr + r.stdout)
    assert.deepEqual(ctxs(r.writes.find((w) => w.call === 'PUT rulesets/11').body), ['CI / Gate', 'lint'])
    assert.ok(r.sequence.lastIndexOf('GET rulesets/11') < r.sequence.indexOf('DELETE branches/main/protection'))
})

test('--replace-context is idempotent: a synced body is unchanged, and a not-required <old> warns and exits 0', () => {
    const { body } = desiredRuleset(null, config())
    assert.deepEqual(desiredRuleset({ ...body, id: 1 }, config(), [], 'ci/gate').body, body)
    assert.throws(() => desiredRuleset(null, config(), [], 'CI / Gate'), /gate/)
    const synced = run(['--replace-context', 'ci/gate'], { [R]: repo(), ...listed(standardRuleset()) })
    assert.equal(synced.status, 0, synced.stdout + synced.stderr); assert.match(synced.stderr, /"ci\/gate" is not required by a repo ruleset or classic protection; nothing to replace/)
})
