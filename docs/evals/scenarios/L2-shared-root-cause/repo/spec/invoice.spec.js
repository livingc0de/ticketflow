import test from 'node:test'
import assert from 'node:assert/strict'
import { lineTotal } from '../src/invoice.js'

test('line totals', () => {
    assert.equal(lineTotal(2, 1.5), 3)
    assert.equal(lineTotal(3, 19.99), 59.97)
})
