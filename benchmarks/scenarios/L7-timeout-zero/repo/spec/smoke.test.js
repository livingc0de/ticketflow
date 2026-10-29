import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTimeout } from '../src/config.js'
test('export exists', () => assert.equal(typeof parseTimeout, 'function'))
