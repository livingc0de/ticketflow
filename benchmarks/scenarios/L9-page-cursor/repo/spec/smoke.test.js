import test from 'node:test'
import assert from 'node:assert/strict'
import { paginate } from '../src/pages.js'
test('export exists', () => assert.equal(typeof paginate, 'function'))
