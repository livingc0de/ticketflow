import test from 'node:test'
import assert from 'node:assert/strict'
import { splitCents } from '../src/allocate.js'
test('export exists', () => assert.equal(typeof splitCents, 'function'))
