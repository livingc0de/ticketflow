#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { formatText } from '../src/report.js'

const rows = JSON.parse(readFileSync(new URL('../data/rows.json', import.meta.url), 'utf8'))
console.log(formatText(rows))
