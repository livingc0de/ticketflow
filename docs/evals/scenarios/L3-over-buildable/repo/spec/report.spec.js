import test from 'node:test'
import assert from 'node:assert/strict'
import { formatText } from '../src/report.js'

test('formatText prints one tab-separated line per row', () => {
    assert.equal(formatText([{ name: 'Ada', team: 'Core', hours: 1 }, { name: 'Bo', team: 'Ops', hours: 2 }]), 'Ada\tCore\t1\nBo\tOps\t2')
})
