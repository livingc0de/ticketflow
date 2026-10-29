import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml } from '../src/html.js'
test('export exists', () => assert.equal(typeof escapeHtml, 'function'))
