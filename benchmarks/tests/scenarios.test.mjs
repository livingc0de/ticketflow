import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../../tests/helpers.mjs'

const ROOT = new URL('../', import.meta.url).pathname
const SCEN = join(ROOT, 'scenarios')
const run = (dir, id, answer = '') => {
    const file = join(dir, 'answer.txt')
    // Store the answer outside the fixture repo: a code review must leave it unchanged.
    const out = join(tempDir('bench-answer-'), 'answer.txt')
    writeFileSync(out, answer)
    const r = spawnSync(process.execPath, [join(SCEN, id, 'check.mjs'), dir, out], { encoding: 'utf8' })
    return { ...r, text: r.stdout + r.stderr }
}
const git = (dir, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
const fixture = (id) => {
    const dir = tempDir('bench-scenario-')
    cpSync(join(SCEN, id, 'repo'), dir, { recursive: true })
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'base')
    return dir
}

const fixed = {
    'L5-path-boundary': [
        'paths.js',
        "import { resolve, isAbsolute, sep } from 'node:path'\nexport function safePath(root, part) { if (isAbsolute(part)) return null; const base=resolve(root), full=resolve(base,part); return full===base || full.startsWith(base+sep) ? full : null }\n"
    ],
    'L6-event-replay': [
        'events.js',
        "export function applyEvent(state,event) { if(state.processed.includes(event.id)) return state; return { balance:state.balance+event.delta, processed:[...state.processed,event.id] } }\n"
    ],
    'L7-timeout-zero': [
        'config.js',
        "export function parseTimeout(raw) { if(raw===undefined) return 5000; const n=Number(raw); return Number.isSafeInteger(n)&&n>=0 ? n : null }\n"
    ],
    'L8-html-escaping': [
        'html.js',
        "const map={'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}\nexport const escapeHtml=(s)=>String(s).replace(/[&<>\"']/g, (c)=>map[c])\n"
    ],
    'L9-page-cursor': [
        'pages.js',
        "export function paginate(rows,start,size) { const end=start+size; return { items:rows.slice(start,end), next:end<rows.length?end:null } }\n"
    ],
    'L10-tenant-isolation': [
        'orders.js',
        "export function lookupOrder(orders,tenantId,id) { return orders.find(o=>o.id===id&&o.tenantId===tenantId)??null }\n"
    ],
    'L11-cent-allocation': [
        'allocate.js',
        "export function splitCents(total,w) { if(total===0) return w.map(()=>0); const sum=w.reduce((a,b)=>a+b,0), exact=w.map(x=>total*x/sum), out=exact.map(Math.floor); let left=total-out.reduce((a,b)=>a+b,0); for(const i of w.map((_,i)=>i).sort((a,b)=>(exact[b]-out[b])-(exact[a]-out[a])||a-b)) { if(left-->0) out[i]++ } return out }\n"
    ],
    'L15-feature-flag': [
        'flags.js',
        "export function isEnabled(x) { return x===true||x===1||(typeof x==='string'&&['true','1'].includes(x.trim().toLowerCase())) }\n"
    ],
}
test('new hidden checks fail on untouched fixtures and pass on reference repairs', () => {
    for (const [id, [name, source]] of Object.entries(fixed)) {
        const dir = fixture(id)
        assert.equal(run(dir, id).status, 1, id + ' must start broken')
        writeFileSync(join(dir, 'src', name), source)
        const meta = JSON.parse(readFileSync(join(SCEN, id, 'cases.json'), 'utf8'))
        if (meta.requireTest) {
            mkdirSync(join(dir, 'spec'), { recursive: true })
            writeFileSync(join(dir, 'spec/regression.test.js'),
                "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('regression',()=>assert.ok(true))\n")
        }
        const good = run(dir, id)
        assert.equal(good.status, 0, id + '\n' + good.text)
        assert.match(good.text, /PASS:/)
    }
})
test('review probes demand the right line and finding without editing', () => {
    for (const [id, path, word] of [
        ['L12-review-authorization','src/access.js','tenant authorization'],
        ['L13-review-cache','src/cache.js','stale cache'],
        ['L14-review-payment-replay','src/payment.js','duplicate idempotent'],
    ]) {
        const dir = fixture(id)
        assert.equal(run(dir,id).status, 1, id + ' must require an answer')
        assert.equal(run(dir,id, path + ':6 ' + word).status, 1, id + ' must require precise line')
        assert.equal(run(dir,id, path + ':7 ' + word).status, 0, id + ' reference finding')
        writeFileSync(join(dir, 'notes.txt'), 'reviewer edited something')
        assert.equal(run(dir,id, path + ':7 ' + word).status, 1, 'review must be read-only')
    }
})
