#!/usr/bin/env node
/**
 * The GitHub Project (Projects v2) of the repo, through GraphQL only.
 *
 * Usage: project.mjs add <issue>                  put an issue in the project (nothing happens when it is already in)
 *        project.mjs status <issue> <Status>      set the Status (adds the issue first when needed)
 *        project.mjs setup [--dry-run]            create (when project.number is 0) or top up the project to the standard
 *        all take [--config f]
 *
 * `setup` never loses data: Status options keep their ids, extra options are dropped only while the project has no items,
 * existing views are only reported, and it reads everything back. See core/lib/project.mjs for the exact rules.
 * Exit: 0 = done / in sync, 1 = unknown Status, or `setup` has actions left (on --dry-run: actions would be taken), 2 = usage, config or API error.
 */

import { cli, main } from '../lib/cli.mjs'
import { GhError, gql, isNumber } from '../lib/gh.mjs'
import { STANDARD, describeAction, normalize, plan } from '../lib/project.mjs'

const usage = 'add <issue> | status <issue> <Status> | setup [--dry-run] [--config f]'
const { values, positionals: [cmd, arg, statusName], cfg } = cli(import.meta.url, 'project', usage, { 'dry-run': { type: 'boolean' } }, (p, v) => {
    if (p[0] === 'add') return p.length === 2 && isNumber(p[1]) && !v['dry-run']
    if (p[0] === 'status') return p.length === 3 && isNumber(p[1]) && !v['dry-run']
    return p[0] === 'setup' && p.length === 1
})
const P = cfg.project
if (!P || (cmd !== 'setup' && P.number === 0)) {
    console.error(`project: ${P ? 'project.number is 0: run "project setup" first and put the number in the config' : 'the config has no project section'}`)
    process.exit(2)
}
const [rOwner, rName] = cfg.repo.split('/')
const where = (number) => `${P.owner}/${number}`

const STATUS_FIELD = '... on ProjectV2SingleSelectField { id options { id name } }'
const TARGET = `query ProjectTarget($rOwner:String!,$rName:String!,$issue:Int!,$owner:String!,$number:Int!){
  repository(owner:$rOwner,name:$rName){ issue(number:$issue){ id projectItems(first:50){ nodes{ id project{ id } } } } }
  repositoryOwner(login:$owner){
    ... on User { projectV2(number:$number){ id field(name:"Status"){ ${STATUS_FIELD} } } }
    ... on Organization { projectV2(number:$number){ id field(name:"Status"){ ${STATUS_FIELD} } } }
  }
}`
const ADD = 'mutation AddProjectItem($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }'
const SET = 'mutation SetProjectStatus($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ projectV2Item{ id } } }'

function itemCommand() {
    const d = gql(TARGET, { rOwner, rName, issue: Number(arg), owner: P.owner, number: P.number })
    const issue = d.repository?.issue
    if (!issue) throw new GhError(`issue #${arg} not found in ${cfg.repo}`)
    const project = d.repositoryOwner?.projectV2
    if (!project) throw new GhError(`project ${where(P.number)} not found`)
    let item = issue.projectItems.nodes.find((n) => n.project.id === project.id)
    let option
    if (cmd === 'status') {
        option = project.field?.options?.find((o) => o.name === statusName)
        if (!option) {
            console.error(`project: no Status "${statusName}". Options: ${(project.field?.options ?? []).map((o) => o.name).join(', ') || '(no Status field)'}`)
            return 1
        }
    }
    if (!item) item = gql(ADD, { p: project.id, c: issue.id }).addProjectV2ItemById.item
    else if (cmd === 'add') return void console.log(`#${arg} already in ${where(P.number)}`)
    if (cmd === 'add') return void console.log(`#${arg} added to ${where(P.number)}`)
    gql(SET, { p: project.id, i: item.id, f: project.field.id, o: option.id })
    console.log(`#${arg} -> ${statusName} (${where(P.number)})`)
}

const SUMMARY = 'id number title'
const OWNER = `query ProjectOwner($rOwner:String!,$rName:String!,$owner:String!,$number:Int!,$byNumber:Boolean!){
  repository(owner:$rOwner,name:$rName){ id }
  repositoryOwner(login:$owner){ id
    ... on User { projectV2(number:$number) @include(if:$byNumber){ ${SUMMARY} } projectsV2(first:100) @skip(if:$byNumber){ nodes{ ${SUMMARY} } pageInfo{ hasNextPage } } }
    ... on Organization { projectV2(number:$number) @include(if:$byNumber){ ${SUMMARY} } projectsV2(first:100) @skip(if:$byNumber){ nodes{ ${SUMMARY} } pageInfo{ hasNextPage } } }
  }
}`
const CREATE = 'mutation CreateProject($o:ID!,$t:String!,$r:ID!){ createProjectV2(input:{ownerId:$o,title:$t,repositoryId:$r}){ projectV2{ id number } } }'
const NAMES = '... on ProjectV2FieldCommon { name }'
const STATE = `query ProjectState($id:ID!){ node(id:$id){ ... on ProjectV2 {
  id number title shortDescription readme
  items(first:1){ totalCount }
  repositories(first:100){ nodes{ nameWithOwner } }
  fields(first:100){ nodes{ ... on ProjectV2FieldCommon { id name dataType } ... on ProjectV2SingleSelectField { options{ id name color description } } } }
  views(first:50){ nodes{ id name layout filter fields(first:100){ nodes{ ${NAMES} } } } }
  workflows(first:50){ nodes{ id name enabled } }
} } }`
const MUTATIONS = {
    'link-repo': ['mutation LinkRepo($p:ID!,$r:ID!){ linkProjectV2ToRepository(input:{projectId:$p,repositoryId:$r}){ repository{ id } } }', (s, a, c) => ({ p: s.id, r: c.repoId })],
    'status-options': ['mutation UpdateStatusOptions($f:ID!,$o:[ProjectV2SingleSelectFieldOptionInput!]){ updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$o}){ projectV2Field{ ... on ProjectV2SingleSelectField { id } } } }', (s, a) => ({ f: a.fieldId, o: a.options })],
    'create-field': ['mutation CreateDateField($p:ID!,$n:String!){ createProjectV2Field(input:{projectId:$p,dataType:DATE,name:$n}){ projectV2Field{ ... on ProjectV2Field { id } } } }', (s, a) => ({ p: s.id, n: a.name })],
    'update-view': ['mutation UpdateView($v:ID!,$n:String,$l:ProjectV2ViewLayout,$f:String,$ids:[ID!]){ updateProjectV2View(input:{viewId:$v,name:$n,layout:$l,filter:$f,configuration:{visibleFieldIds:$ids}}){ projectV2View{ id } } }', (s, a) => ({ v: a.viewId, n: a.name, l: a.layout, f: a.filter || undefined, ids: a.fieldIds })],
    'delete-workflow': ['mutation DeleteWorkflow($w:ID!){ deleteProjectV2Workflow(input:{workflowId:$w}){ deletedWorkflowId } }', (s, a) => ({ w: a.id })],
    describe: ['mutation DescribeProject($p:ID!,$readme:String,$short:String){ updateProjectV2(input:{projectId:$p,readme:$readme,shortDescription:$short}){ projectV2{ id } } }', (s, a) => ({ p: s.id, readme: a.readme, short: a.shortDescription })],
}
const CREATE_VIEW = 'mutation CreateView($p:ID!,$n:String!,$l:ProjectV2ViewLayout!,$ids:[ID!]){ createProjectV2View(input:{projectId:$p,name:$n,layout:$l,configuration:{visibleFieldIds:$ids}}){ projectV2View{ id } } }'

function apply(state, action, ctx) {
    if (action.op === 'create-view') {
        const id = gql(CREATE_VIEW, { p: state.id, n: action.name, l: action.layout, ids: action.fieldIds }).createProjectV2View.projectV2View.id
        if (action.filter) gql(MUTATIONS['update-view'][0], { v: id, f: action.filter })   // create has no filter input
    } else {
        const [query, vars] = MUTATIONS[action.op]
        gql(query, vars(state, action, ctx))
    }
}

function setup() {
    const d = gql(OWNER, { rOwner, rName, owner: P.owner, number: P.number, byNumber: P.number > 0 })
    const owner = d.repositoryOwner
    if (!owner) throw new GhError(`owner ${P.owner} not found`)
    if (!d.repository) throw new GhError(`repository ${cfg.repo} not found`)
    let project
    if (P.number > 0) {
        project = owner.projectV2
        if (!project) throw new GhError(`project ${where(P.number)} not found`)
    } else {
        const same = owner.projectsV2.nodes.filter((p) => p.title === P.title)
        if (same.length > 1) throw new GhError(`${same.length} projects of ${P.owner} are titled "${P.title}": set project.number`)
        project = same[0]
        if (owner.projectsV2.pageInfo?.hasNextPage) throw new GhError(`${P.owner} has more than 100 projects, so the title lookup is not safe: set project.number`)
    }
    if (!project) {
        console.log(`no project titled "${P.title}": create it and link ${cfg.repo}`)
        if (values['dry-run']) return 1
        project = gql(CREATE, { o: owner.id, t: P.title, r: d.repository.id }).createProjectV2.projectV2
        console.log(`created project ${where(project.number)}: set project.number to ${project.number} in the config`)
    }
    const read = () => normalize(gql(STATE, { id: project.id }).node)
    const state = read()
    const { actions, notes } = plan(state, cfg.repo, STANDARD, P.views)
    for (const a of actions) console.log(`${values['dry-run'] ? 'would ' : ''}${describeAction(a)}`)
    if (values['dry-run']) {
        for (const n of notes) console.log(`note: ${n}`)
        return actions.length ? 1 : 0
    }
    const ctx = { repoId: d.repository.id }
    for (const a of actions) apply(state, a, ctx)
    const after = plan(read(), cfg.repo, STANDARD, P.views)
    for (const n of after.notes) console.log(`note: ${n}`)
    for (const a of after.actions) console.error(`project: still to do after apply: ${describeAction(a)}`)
    if (!after.actions.length) console.log(`project ${where(project.number)} is at the standard`)
    return after.actions.length ? 1 : 0
}

main('project', () => (cmd === 'setup' ? setup() : itemCommand()))
