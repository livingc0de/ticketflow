import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { STANDARD, normalize, plan, PlanError } from '../core/lib/project.mjs'
import { fakeGh, seq, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/project.mjs', import.meta.url).pathname
const nodes = (xs) => ({ nodes: xs })
const BUILTIN = ['Title', 'Assignees', 'Labels', 'Milestone', 'Linked pull requests', 'Parent issue', 'Sub-issues progress', 'Repository', 'Reviewers']
const builtins = () => BUILTIN.map((name) => ({ id: `F_${name}`, name, dataType: 'TEXT' }))
const opt = (name, color = 'GRAY', description = '') => ({ id: `O_${name}`, name, color, description })
const statusField = (options) => ({ id: 'F_Status', name: 'Status', dataType: 'SINGLE_SELECT', options })
const view = (name, layout, filter, fields) => ({ id: `V_${name}`, name, layout, filter, fields: nodes(fields.map((n) => ({ name: n }))) })
const WORKFLOWS = [...STANDARD.workflows, 'Item added to project']

/** The `node` GraphQL result of a project; `over` replaces top-level keys. */
const node = (over = {}) => ({
    id: 'P1', number: 7, title: 't', shortDescription: '', readme: '',
    items: { totalCount: 0 }, repositories: nodes([{ nameWithOwner: 'o/r' }]),
    fields: nodes([...builtins(), statusField([opt('Todo'), opt('In Progress', 'YELLOW'), opt('Done', 'PURPLE')])]),
    views: nodes([view('View 1', 'TABLE_LAYOUT', '', ['Title', 'Status'])]),
    workflows: nodes(WORKFLOWS.map((name) => ({ id: `W_${name}`, name, enabled: true }))),
    ...over,
})
/** A project exactly at the standard (all optional views when `optional`). */
const standardNode = (optional = []) => node({
    shortDescription: 'x', readme: 'x',
    fields: nodes([...builtins(), statusField(STANDARD.status.map((s) => opt(s.name, s.color, s.description))), { id: 'F_s', name: 'Start Date', dataType: 'DATE' }, { id: 'F_t', name: 'Target Date', dataType: 'DATE' }]),
    views: nodes(STANDARD.views.filter((v) => !v.optional || optional.includes(v.name)).map((v) => view(v.name, v.layout, v.filter, v.fields ?? ['Title']))),
    workflows: nodes(STANDARD.workflows.map((name) => ({ id: `W_${name}`, name, enabled: true }))),
})
const ops = (state, optional) => plan(normalize(state), 'o/r', STANDARD, optional).actions.map((a) => a.op)

test('a fresh project gets the exact action list of the standard, keeping the ids of existing options', () => {
    const { actions } = plan(normalize(node()), 'o/r')
    assert.deepEqual(actions.map((a) => a.op), ['status-options', 'create-field', 'create-field', 'update-view', 'create-view', 'delete-workflow', 'describe'])
    const [status, , , board, roadmap, workflow, describe] = actions
    assert.deepEqual(status.options.map((o) => o.name), STANDARD.status.map((s) => s.name))
    assert.equal(status.options.find((o) => o.name === 'In Progress').id, 'O_In Progress')
    assert.equal(status.options.find((o) => o.name === 'Done').id, 'O_Done')
    for (const name of ['Inbox', 'Backlog', 'Ready', 'In Review', 'Blocked', 'Future']) assert.equal(status.options.find((o) => o.name === name).id, undefined)
    assert.deepEqual(status.dropped, ['Todo'])
    assert.equal(board.viewId, 'V_View 1'); assert.equal(board.name, 'Work Board'); assert.equal(board.layout, 'BOARD_LAYOUT')
    assert.deepEqual(board.fieldIds, ['F_Title', 'F_Assignees', 'F_Status', 'F_Labels', 'F_Milestone', 'F_Sub-issues progress'])
    assert.equal(roadmap.filter, 'is:open'); assert.equal(roadmap.fieldIds, undefined)   // the API refuses visible fields on a Roadmap
    assert.equal(workflow.name, 'Item added to project')
    assert.match(describe.readme, /^# o\/r work/); assert.equal(describe.shortDescription, 'Work tracking for o/r')
})

test('a project at the standard has no actions and no notes', () => {
    assert.deepEqual(plan(normalize(standardNode()), 'o/r'), { actions: [], notes: [] })
    const all = STANDARD.views.filter((v) => v.optional).map((v) => v.name)
    assert.deepEqual(plan(normalize(standardNode(all)), 'o/r', STANDARD, all), { actions: [], notes: [] })
})

test('a project with items keeps every status id, drops nothing and only reports view differences', () => {
    const std = standardNode()
    const options = STANDARD.status.filter((s) => s.name !== 'Future').map((s) => opt(s.name, 'ORANGE', 'mine')).concat(opt('Archived'))
    const n = node({
        ...std, items: { totalCount: 12 },
        fields: nodes([...builtins(), statusField(options), { id: 'F_s', name: 'Start Date', dataType: 'DATE' }, { id: 'F_t', name: 'Target Date', dataType: 'DATE' }]),
        views: nodes([view('Roadmap', 'ROADMAP_LAYOUT', '', ['Title']), view('Work Board', 'BOARD_LAYOUT', '', STANDARD.views[0].fields)]),
        workflows: nodes([...STANDARD.workflows, 'Item added to project'].map((name) => ({ id: `W_${name}`, name, enabled: true }))),
    })
    const { actions, notes } = plan(normalize(n), 'o/r')
    assert.deepEqual(actions.map((a) => a.op), ['status-options'])
    const sent = actions[0].options
    assert.deepEqual(sent.map((o) => o.name), [...STANDARD.status.map((s) => s.name), 'Archived'])
    for (const o of options) assert.equal(sent.find((x) => x.name === o.name).id, o.id)
    assert.equal(sent.find((x) => x.name === 'Inbox').color, 'ORANGE')   // existing options keep their look
    assert.equal(sent.find((x) => x.name === 'Future').id, undefined)
    assert.deepEqual(actions[0].dropped, [])
    assert.ok(notes.some((x) => /Archived.*kept/.test(x)))
    assert.ok(notes.some((x) => /View "Roadmap" differs: filter "" \(standard "is:open"\)/.test(x)))
    assert.ok(notes.some((x) => /order/.test(x)))
    assert.ok(notes.some((x) => /"Item added to project" is enabled/.test(x)))
})

test('with items, the default view is never renamed: Work Board is created instead', () => {
    const n = standardNode(); n.items = { totalCount: 3 }
    n.views = nodes([view('View 1', 'TABLE_LAYOUT', '', ['Title']), ...n.views.nodes.filter((v) => v.name !== 'Work Board')])
    const { actions } = plan(normalize(n), 'o/r')
    assert.deepEqual(actions.map((a) => [a.op, a.name, a.viewId]), [['create-view', 'Work Board', undefined]])
})

test('Status options that differ only in case are a PlanError, never a silent drop', () => {
    const n = standardNode(); n.items = { totalCount: 3 }
    n.fields.nodes.find((f) => f.name === 'Status').options.push(opt('done', 'GREEN'))
    assert.throws(() => plan(normalize(n), 'o/r'), (e) => e instanceof PlanError && /differ only in case/.test(e.message))
})

test('a Status option that differs only in case keeps its id and gets the standard case', () => {
    const n = standardNode(); n.items = { totalCount: 3 }
    n.fields.nodes.find((f) => f.name === 'Status').options.find((o) => o.name === 'In Progress').name = 'in progress'
    const status = plan(normalize(n), 'o/r').actions[0]
    assert.deepEqual(status.options.filter((o) => o.id === 'O_In Progress').map((o) => o.name), ['In Progress'])
    assert.equal(status.options.length, 8)
})

test('only the chosen optional views are created', () => {
    const base = standardNode()
    assert.deepEqual(ops(base, ['Initiatives']), ['create-view'])
    const created = plan(normalize(base), 'o/r', STANDARD, ['Initiatives', 'P0/P1 Open']).actions.map((a) => a.name)
    assert.deepEqual(created, ['Initiatives', 'P0/P1 Open'])
    assert.deepEqual(ops(base, []), [])
})

test('a repo that is not linked is linked; a disabled standard workflow is reported', () => {
    const n = standardNode(); n.repositories = nodes([]); n.workflows = nodes(STANDARD.workflows.map((name, i) => ({ id: `W${i}`, name, enabled: i !== 0 })))
    const r = plan(normalize(n), 'o/r')
    assert.deepEqual(r.actions.map((a) => a.op), ['link-repo'])
    assert.ok(r.notes.some((x) => /"Auto-add sub-issues to project" is not enabled/.test(x)))
    n.repositories = nodes([{ nameWithOwner: 'o/r' }])
    assert.deepEqual(plan(normalize(n), 'O/R').actions, [])   // the repo name compares ignoring case
})

test('a non-date Start Date field or a missing Status field is a PlanError', () => {
    const text = standardNode(); text.fields = nodes([...builtins(), statusField([opt('Todo')]), { id: 'x', name: 'Start Date', dataType: 'TEXT' }])
    assert.throws(() => plan(normalize(text), 'o/r'), (e) => e instanceof PlanError && /Start Date.*TEXT/.test(e.message))
    assert.throws(() => plan(normalize(node({ fields: nodes(builtins()) })), 'o/r'), PlanError)
})

// --- the script, against a fake gh ---

const OWNER_KEY = 'graphql ProjectOwner', STATE_KEY = 'graphql ProjectState'
function setup(args, states, { over, owner } = {}) {
    const dir = tempDir('project-')
    const gh = fakeGh(dir, {
        [OWNER_KEY]: { repository: { id: 'R1' }, repositoryOwner: owner ?? { id: 'U1', projectV2: { id: 'P1', number: 7, title: 't' } } },
        [STATE_KEY]: seq(...states.map((s) => ({ node: s }))),
        'graphql UpdateStatusOptions': {}, 'graphql CreateDateField': {}, 'graphql UpdateView': {}, 'graphql DeleteWorkflow': {},
        'graphql DescribeProject': {}, 'graphql LinkRepo': {}, 'graphql CreateProject': { createProjectV2: { projectV2: { id: 'P9', number: 9 } } },
        'graphql CreateView': { createProjectV2View: { projectV2View: { id: 'V_new' } } },
    })
    const r = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir, { project: { owner: 'octo', number: 7, ...over } })], { encoding: 'utf8', env: gh.env })
    const sent = gh.log().filter((c) => c.stdin).map((c) => JSON.parse(c.stdin))
    const names = sent.map((x) => /(?:query|mutation) (\w+)/.exec(x.query)[1])
    return { ...r, sent, names, writes: names.filter((x) => !/^Project(Owner|State|Target)$/.test(x)), calls: gh.calls() }
}

test('setup applies the plan in order, reads back and exits 0 when the standard is reached', () => {
    const r = setup(['setup'], [node(), standardNode()])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.writes, ['UpdateStatusOptions', 'CreateDateField', 'CreateDateField', 'UpdateView', 'CreateView', 'UpdateView', 'DeleteWorkflow', 'DescribeProject'])
    const opts = r.sent[r.names.indexOf('UpdateStatusOptions')].variables.o
    assert.equal(opts.find((o) => o.name === 'In Progress').id, 'O_In Progress')
    assert.equal(opts.some((o) => o.name === 'Todo'), false)
    const roadmapFilter = r.sent[r.names.lastIndexOf('UpdateView')].variables
    assert.deepEqual([roadmapFilter.v, roadmapFilter.f], ['V_new', 'is:open'])
    assert.match(r.stdout, /project octo\/7 is at the standard/)
})

test('setup --dry-run makes no mutation and exits 1 while actions are pending', () => {
    const r = setup(['setup', '--dry-run'], [node()])
    assert.equal(r.status, 1)
    assert.deepEqual(r.writes, [])
    assert.match(r.stdout, /would set Status options/)
    assert.equal(setup(['setup', '--dry-run'], [standardNode()]).status, 0)
})

test('a read-back that still differs exits 1 and lists what remains', () => {
    const r = setup(['setup'], [node(), node()])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /still to do after apply: set Status options/)
})

test('a text Start Date field and a missing project exit 2 with no writes', () => {
    const text = node(); text.fields.nodes.push({ id: 'x', name: 'Start Date', dataType: 'TEXT' })
    const a = setup(['setup'], [text])
    assert.equal(a.status, 2); assert.match(a.stderr, /Start Date/); assert.deepEqual(a.writes, [])
    const b = setup(['setup'], [node()], { owner: { id: 'U1', projectV2: null } })
    assert.equal(b.status, 2); assert.match(b.stderr, /project octo\/7 not found/); assert.deepEqual(b.writes, [])
})

test('number 0: an exact-title match is used, none creates (and links the repo), several exit 2', () => {
    const p = (n, title) => ({ id: `P${n}`, number: n, title })
    const cfg = { number: 0, title: 'Work' }
    const one = setup(['setup'], [standardNode()], { over: cfg, owner: { id: 'U1', projectsV2: nodes([p(3, 'Work'), p(4, 'Work 2')]) } })
    assert.equal(one.status, 0, one.stderr); assert.deepEqual(one.writes, [])
    const none = setup(['setup'], [standardNode()], { over: cfg, owner: { id: 'U1', projectsV2: nodes([p(4, 'Work 2')]) } })
    assert.equal(none.status, 0, none.stderr)
    assert.deepEqual(none.sent[none.names.indexOf('CreateProject')].variables, { o: 'U1', t: 'Work', r: 'R1' })
    assert.match(none.stdout, /set project.number to 9/)
    const dry = setup(['setup', '--dry-run'], [], { over: cfg, owner: { id: 'U1', projectsV2: nodes([]) } })
    assert.equal(dry.status, 1); assert.deepEqual(dry.writes, [])
    const many = setup(['setup'], [], { over: cfg, owner: { id: 'U1', projectsV2: nodes([p(3, 'Work'), p(4, 'Work')]) } })
    assert.equal(many.status, 2); assert.deepEqual(many.writes, [])
})

test('number 0 with no title match but more projects than one page exits 2 instead of creating a duplicate', () => {
    const r = setup(['setup'], [standardNode()], { over: { number: 0, title: 'Work' }, owner: { id: 'U1', projectsV2: { nodes: [], pageInfo: { hasNextPage: true } } } })
    assert.equal(r.status, 2); assert.match(r.stderr, /more than 100 projects/); assert.deepEqual(r.writes, [])
})

test('a GraphQL error exits 2', () => {
    const dir = tempDir('project-')
    const gh = fakeGh(dir, { [OWNER_KEY]: { errors: [{ message: 'boom' }] } })
    const r = spawnSync(process.execPath, [script, 'setup', '--config', writeConfig(dir, { project: { owner: 'octo', number: 7 } })], { encoding: 'utf8', env: gh.env })
    assert.equal(r.status, 2); assert.match(r.stderr, /boom/)
})

// --- add / status ---

function item(args, { inProject = false, over = { number: 7 }, field } = {}) {
    const dir = tempDir('project-')
    const status = field ?? { id: 'F_Status', options: STANDARD.status.map((s) => ({ id: `O_${s.name}`, name: s.name })) }
    const gh = fakeGh(dir, {
        'graphql ProjectTarget': {
            repository: { issue: { id: 'I1', projectItems: nodes(inProject ? [{ id: 'IT1', project: { id: 'P1' } }, { id: 'IT2', project: { id: 'other' } }] : [{ id: 'IT2', project: { id: 'other' } }]) } },
            repositoryOwner: { projectV2: { id: 'P1', field: status } },
        },
        'graphql AddProjectItem': { addProjectV2ItemById: { item: { id: 'IT9' } } }, 'graphql SetProjectStatus': {},
    })
    const r = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir, { project: { owner: 'octo', ...over } })], { encoding: 'utf8', env: gh.env })
    const sent = gh.log().filter((c) => c.stdin).map((c) => JSON.parse(c.stdin))
    return { ...r, sent, names: sent.map((x) => /(?:query|mutation) (\w+)/.exec(x.query)[1]), calls: gh.calls() }
}

test('status adds a missing item, then sets the option found by name on the live field', () => {
    const r = item(['status', '5', 'In Review'])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.names, ['ProjectTarget', 'AddProjectItem', 'SetProjectStatus'])
    assert.deepEqual(r.sent[2].variables, { p: 'P1', i: 'IT9', f: 'F_Status', o: 'O_In Review' })
    assert.equal(r.stdout.trim(), '#5 -> In Review (octo/7)')
})

test('status on an issue already in the project does not add it again', () => {
    const r = item(['status', '5', 'Done'], { inProject: true })
    assert.deepEqual(r.names, ['ProjectTarget', 'SetProjectStatus'])
    assert.equal(r.sent[1].variables.i, 'IT1')
})

test('an unknown status exits 1, lists the options and writes nothing', () => {
    const r = item(['status', '5', 'Nope'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /no Status "Nope". Options: Inbox, Backlog, Ready, In Progress, In Review, Blocked, Done, Future/)
    assert.deepEqual(r.names, ['ProjectTarget'])
})

test('add puts the issue in once, and says so when it is already there', () => {
    assert.deepEqual(item(['add', '5']).names, ['ProjectTarget', 'AddProjectItem'])
    const again = item(['add', '5'], { inProject: true })
    assert.deepEqual(again.names, ['ProjectTarget'])
    assert.match(again.stdout, /already in/)
})

test('project.number 0, a missing project section and bad arguments exit 2 before any call', () => {
    assert.equal(item(['add', '5'], { over: { number: 0, title: 't' } }).status, 2)
    for (const a of [['add', '5;x'], ['status', '5'], ['add'], ['nope'], ['add', '5', '--dry-run']]) {
        const r = item(a)
        assert.equal(r.status, 2, a.join(' ')); assert.deepEqual(r.calls, [])
    }
    const dir = tempDir('project-')
    const gh = fakeGh(dir, {})
    const r = spawnSync(process.execPath, [script, 'add', '5', '--config', writeConfig(dir)], { encoding: 'utf8', env: gh.env })
    assert.equal(r.status, 2); assert.match(r.stderr, /no project section/); assert.deepEqual(gh.calls(), [])
})

test('every label used in a STANDARD view filter is in core/templates/labels.json', () => {
    const labels = JSON.parse(readFileSync(new URL('../core/templates/labels.json', import.meta.url), 'utf8')).map((l) => l.name)
    const used = STANDARD.views.flatMap((v) => [...v.filter.matchAll(/label:("[^"]+"(?:,"[^"]+")*)/g)].flatMap((m) => m[1].split(',')).map((s) => s.replaceAll('"', '')))
    assert.ok(used.length >= 4)
    for (const name of used) assert.ok(labels.includes(name), name)
})
