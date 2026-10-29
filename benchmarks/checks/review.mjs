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
const location = new RegExp(c.path.replaceAll('.', '\\.') + ':[Ll]?' + c.line + '(?!\\d)')
const finding = lines.some((line) => location.test(line) && c.words.some((w) => new RegExp(w, 'i').test(line)))
if (!finding) fail('missing correctly located finding: ' + c.path + ':' + c.line)
console.log('PASS: located finding and no repository edits')
