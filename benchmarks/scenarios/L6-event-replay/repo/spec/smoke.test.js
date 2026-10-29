import test from 'node:test'
import assert from 'node:assert/strict'
import { applyEvent } from '../src/events.js'
test('export exists', () => assert.equal(typeof applyEvent, 'function'))
