import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const LABEL = /^[a-z][a-z0-9-]{0,30}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Resolve the shared dated publication convention for benchmark reports. */
export function reportTarget({ publish = false, out = null, extraOutputs = [], label = null, date = null,
    suite, defaultLabel, defaultDir }) {
    if (publish && (out || extraOutputs.length)) throw Error('--publish writes Markdown only; do not combine it with --out or auxiliary outputs')
    const effectiveLabel = label ?? defaultLabel
    const effectiveDate = date ?? new Date().toISOString().slice(0, 10)
    if (publish && (!LABEL.test(effectiveLabel) || !DATE.test(effectiveDate)))
        throw Error('publication label/date must be a lowercase slug and YYYY-MM-DD')
    return publish ? resolve(join(defaultDir, `${effectiveDate}-${suite}-${effectiveLabel}.md`)) : out ? resolve(out) : null
}

export function writeReport(target, markdown) {
    if (!target) return false
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, markdown)
    return true
}
