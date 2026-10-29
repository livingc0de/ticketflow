#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
process.argv[4] = fileURLToPath(new URL('.', import.meta.url))
await import('../../checks/review.mjs')
