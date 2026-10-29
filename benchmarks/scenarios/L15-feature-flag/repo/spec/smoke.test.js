import test from 'node:test'
import assert from 'node:assert/strict'
import { isEnabled } from '../src/flags.js'
test('export exists', () => assert.equal(typeof isEnabled, 'function'))
