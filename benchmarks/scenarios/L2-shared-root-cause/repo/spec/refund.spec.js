import test from 'node:test'
import assert from 'node:assert/strict'
import { refundAmount } from '../src/refund.js'

test('refund amounts', () => {
    assert.equal(refundAmount(80, 25), 20)
    assert.equal(refundAmount(33.33, 100), 33.33)
})
