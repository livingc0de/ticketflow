#!/usr/bin/env node
/** Hidden read-only code-review check. Heuristic citation checks do not prove review quality. */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
const [dir, answer, scenario] = process.argv.slice(2)
const fail = (s) => { console.log('FAIL: ' + s); process.exit(1) }
const c = JSON.parse(readFileSync(join(scenario, 'cases.json'), 'utf8'))
const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim()
if (git('status', '--porcelain') || git('rev-list', '--count', 'HEAD') !== '1') fail('a review must not modify the repository')
let text
try { text = readFileSync(answer, 'utf8') } catch { fail('no review answer') }
const lines = text.split(/\r?\n/)
const escaped = c.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const citation = new RegExp(`(?:^|[^A-Za-z0-9_./-])${escaped}:[Ll]?(\\d+)(?:-(\\d+))?(?=$|[^0-9])`)
const parsed = lines.map((line) => ({ line, match: line.match(citation) })).filter((x) => x.match)
const covers = parsed.filter(({ match }) => {
    const first = Number(match[1]), last = Number(match[2] ?? match[1])
    return first <= c.line && c.line <= last
})
const finding = covers.some(({ line }) => c.words.some((w) => new RegExp(w, 'i').test(line)))
if (!parsed.length) fail('no line of the answer names ' + c.path + ':' + c.line + ' (citation heuristic)')
if (!covers.length) fail('no line of the answer names ' + c.path + ':' + c.line + ' (range excludes required line)')
if (!finding) fail('no line of the answer names ' + c.path + ':' + c.line + ' with the required finding language')
console.log('PASS: located finding and no repository edits')
