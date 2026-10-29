import test from 'node:test'
import assert from 'node:assert/strict'
import { lookupOrder } from '../src/orders.js'
test('export exists', () => assert.equal(typeof lookupOrder, 'function'))
