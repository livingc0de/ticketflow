/**
 * The standard GitHub Project (Projects v2) and the pure planner that compares a live project with it.
 * `plan` never reads or writes anything: `scripts/project.mjs` reads the state, applies the actions and reads back.
 *
 * State shape (see `normalize`): { id, number, title, itemCount, readme, shortDescription, repos: [nameWithOwner],
 *   fields: [{ id, name, dataType, options? }], views: [{ id, name, layout, filter, fields: [name] }], workflows: [{ id, name, enabled }] }
 */

import { ConfigError } from './config.mjs'

export class PlanError extends ConfigError {
    name = 'PlanError'
}

const STATUS = [
    ['Inbox', 'GRAY', 'Not triaged yet'],
    ['Backlog', 'BLUE', 'Accepted, not ready to start'],
    ['Ready', 'YELLOW', 'Scope is clear and nothing blocks it'],
    ['In Progress', 'BLUE', 'Claimed and being worked on'],
    ['In Review', 'PURPLE', 'Merged, awaiting the owner\'s review'],
    ['Blocked', 'RED', 'Waiting on a named blocker'],
    ['Done', 'GREEN', 'Accepted by the owner'],
    ['Future', 'BLUE', 'Deliberately deferred; not a completion state'],
]

const TITLED = ['Title', 'Status', 'Labels', 'Milestone', 'Sub-issues progress']
const LABEL_VIEW = { layout: 'TABLE_LAYOUT', fields: TITLED }

export const STANDARD = Object.freeze({
    status: STATUS.map(([name, color, description]) => ({ name, color, description })),
    dates: ['Start Date', 'Target Date'],
    /** In this order: the two standard views first, then the optional ones the config picks. */
    views: [
        { name: 'Work Board', layout: 'BOARD_LAYOUT', filter: '', fields: ['Title', 'Assignees', 'Status', 'Labels', 'Milestone', 'Sub-issues progress'] },
        // the API refuses visible fields on a Roadmap (`fields: null`): its fields are neither set nor compared
        { name: 'Roadmap', layout: 'ROADMAP_LAYOUT', filter: 'is:open', fields: null },
        { name: 'All Work', optional: true, layout: 'TABLE_LAYOUT', filter: '', fields: ['Title', 'Assignees', 'Status', 'Labels', 'Linked pull requests', 'Milestone', 'Parent issue', 'Sub-issues progress'] },
        { name: 'Initiatives', optional: true, ...LABEL_VIEW, filter: 'label:"Type: Initiative"' },
        { name: 'Open Decisions', optional: true, ...LABEL_VIEW, filter: 'is:open label:"Type: Decision"' },
        { name: 'P0/P1 Open', optional: true, ...LABEL_VIEW, filter: 'is:open label:"Priority: P0 Critical","Priority: P1 High" -label:"Type: Initiative"' },
    ],
    workflows: ['Auto-add sub-issues to project', 'Auto-close issue', 'Item closed', 'Pull request linked to issue', 'Pull request merged'],
    /** New projects get this one enabled; the standard has none that adds items on its own. */
    removeWorkflow: 'Item added to project',
    readme: [
        '# {repo} work',
        '',
        'Status flow: Inbox (not triaged), Backlog (accepted), Ready (scope clear, unblocked), In Progress (claimed),',
        'In Review (merged, awaiting the owner), Done (accepted by the owner), Blocked (a named blocker), Future (deferred).',
        '',
        'Type, Priority, Effort, AI Model, AI Effort and configured Environment values are labels. Pull requests say `Ticket #N`, never a closing keyword.',
    ].join('\n'),
    shortDescription: 'Work tracking for {repo}',
})

const clean = (s) => (s ?? '').trim()

/** Flattens the `ProjectState` GraphQL result (the `node` of the project). */
export function normalize(node) {
    const nodes = (c) => c?.nodes?.filter(Boolean) ?? []
    return {
        id: node.id, number: node.number, title: node.title,
        itemCount: node.items.totalCount,
        readme: clean(node.readme), shortDescription: clean(node.shortDescription),
        repos: nodes(node.repositories).map((r) => r.nameWithOwner),
        fields: nodes(node.fields).map((f) => ({ id: f.id, name: f.name, dataType: f.dataType, ...(f.options ? { options: f.options.map((o) => ({ id: o.id, name: o.name, color: o.color, description: o.description ?? '' })) } : {}) })),
        views: nodes(node.views).map((v) => ({ id: v.id, name: v.name, layout: v.layout, filter: clean(v.filter), fields: nodes(v.fields).map((f) => f.name) })),
        workflows: nodes(node.workflows).map((w) => ({ id: w.id, name: w.name, enabled: w.enabled })),
    }
}

const sameOption = (a, b) => a.id === b.id && a.name === b.name && a.color === b.color && a.description === b.description

/**
 * Compares `state` with `std`. Returns { actions, notes }: `actions` are the writes that would bring the project to the standard
 * (in apply order); `notes` are differences that are only reported (they never make a read-back fail). Throws PlanError when the
 * project cannot be topped up safely (no single-select Status field). A Start/Target Date field of another type is only noted.
 *
 * Nothing is lost: every existing Status option keeps its id; extra options are dropped only while the project has no items;
 * existing views are never changed; "Item added to project" is deleted only while the project has no items.
 */
export function plan(state, repo, std = STANDARD, optionalViews = []) {
    const actions = [], notes = []
    const fill = (s) => s.replaceAll('{repo}', repo)
    // shortcut: the item count is read once (an item added in the seconds before the writes could lose a dropped option's value), read it again if that race is ever seen
    const fresh = state.itemCount === 0

    if (!state.repos.some((r) => r.toLowerCase() === repo.toLowerCase())) actions.push({ op: 'link-repo' })

    const status = state.fields.find((f) => f.name === 'Status')
    if (!status?.options) throw new PlanError('the project has no single-select Status field')
    const lower = (s) => s.toLowerCase()
    const byName = new Map(status.options.map((o) => [lower(o.name), o]))
    if (byName.size !== status.options.length) throw new PlanError('the Status field has options that differ only in case: merge them by hand')
    const want = std.status.map((s) => {
        const o = byName.get(lower(s.name))   // a different case keeps the id and only fixes the case
        return o ? (fresh ? { ...s, id: o.id } : { ...o, name: s.name }) : s   // a project with items keeps its own colours and descriptions
    })
    const extra = status.options.filter((o) => !std.status.some((s) => lower(s.name) === lower(o.name)))
    if (!fresh) {
        want.push(...extra)
        for (const o of extra) notes.push(`Status option "${o.name}" is not standard; kept because the project has items`)
    }
    const current = status.options
    if (want.length !== current.length || want.some((o, i) => !sameOption(o, current[i]))) {
        actions.push({ op: 'status-options', fieldId: status.id, options: want, dropped: fresh ? extra.map((o) => o.name) : [] })
    }

    // the Roadmap's date fields: created when missing, never required to be filled; a same-named field of another type is the repo's
    for (const name of std.dates) {
        const f = state.fields.find((x) => x.name === name)
        if (!f) actions.push({ op: 'create-field', name })
        else if (f.dataType !== 'DATE') notes.push(`field "${name}" is ${f.dataType}, not DATE: kept as it is; the Roadmap cannot use it`)
    }

    const visible = (names) => names.map((n) => state.fields.find((f) => f.name === n)).filter(Boolean).map((f) => f.id)
    const wanted = std.views.filter((v) => !v.optional || optionalViews.includes(v.name))
    for (const v of wanted) {
        const have = state.views.find((x) => x.name === v.name)
        if (have) {
            const diffs = []
            if (have.layout !== v.layout) diffs.push(`layout ${have.layout} (standard ${v.layout})`)
            if (have.filter !== v.filter) diffs.push(`filter "${have.filter}" (standard "${v.filter}")`)
            const missing = (v.fields ?? []).filter((n) => !have.fields.includes(n)), extraFields = v.fields ? have.fields.filter((n) => !v.fields.includes(n)) : []
            if (missing.length || extraFields.length) diffs.push(`fields${missing.length ? ` missing ${missing.join(', ')}` : ''}${extraFields.length ? ` extra ${extraFields.join(', ')}` : ''}`)
            if (diffs.length) notes.push(`View "${v.name}" differs: ${diffs.join('; ')}. Existing views are not changed`)
            continue
        }
        const spec = { name: v.name, layout: v.layout, filter: v.filter, fieldIds: v.fields ? visible(v.fields) : undefined }
        const first = state.views.find((x) => x.name === 'View 1')
        if (v.name === 'Work Board' && fresh && first) actions.push({ op: 'update-view', viewId: first.id, ...spec })   // the default view stays first
        else actions.push({ op: 'create-view', ...spec })
    }
    const order = wanted.map((v) => v.name).filter((n) => state.views.some((x) => x.name === n))
    const live = state.views.map((v) => v.name).filter((n) => order.includes(n))
    if (order.join('\n') !== live.join('\n')) notes.push(`Views are in the order ${live.join(', ')} (standard ${order.join(', ')}); existing views cannot be reordered through the API`)

    const drop = state.workflows.find((w) => w.name === std.removeWorkflow)
    if (drop && fresh) actions.push({ op: 'delete-workflow', id: drop.id, name: drop.name })
    else if (drop?.enabled) notes.push(`Workflow "${drop.name}" is enabled and the project has items: left as is`)
    for (const name of std.workflows) {
        if (!state.workflows.some((w) => w.name === name && w.enabled)) notes.push(`Workflow "${name}" is not enabled: turn it on in the project's Workflows page (the API cannot)`)
    }

    const describe = {}
    if (!state.readme) describe.readme = fill(std.readme)
    if (!state.shortDescription) describe.shortDescription = fill(std.shortDescription)
    if (Object.keys(describe).length) actions.push({ op: 'describe', ...describe })

    return { actions, notes }
}

/** One printable line per action. */
export function describeAction(a) {
    switch (a.op) {
        case 'link-repo': return 'link the repository to the project'
        case 'status-options': return `set Status options: ${a.options.map((o) => o.name).join(', ')}${a.dropped.length ? ` (dropping unused: ${a.dropped.join(', ')})` : ''}`
        case 'create-field': return `create date field "${a.name}"`
        case 'update-view': return `turn the default view into "${a.name}" (${a.layout}${a.filter ? `, filter ${a.filter}` : ''})`
        case 'create-view': return `create view "${a.name}" (${a.layout}${a.filter ? `, filter ${a.filter}` : ''})`
        case 'delete-workflow': return `delete workflow "${a.name}"`
        case 'describe': return `set ${Object.keys(a).filter((k) => k !== 'op').join(' and ')}`
        default: return a.op
    }
}
