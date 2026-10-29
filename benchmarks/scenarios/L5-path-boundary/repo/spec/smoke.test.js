import test from 'node:test'
import assert from 'node:assert/strict'
import { safePath } from '../src/paths.js'
test('export exists', () => assert.equal(typeof safePath, 'function'))
