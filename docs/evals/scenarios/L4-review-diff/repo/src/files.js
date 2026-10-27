import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Returns the text of an uploaded file, or null when there is none.
// Uploads may live in sub-folders such as 2026/report.txt.
export function readUpload(root, name) {
    const file = join(root, name)
    if (!existsSync(file)) return null
    return readFileSync(file, 'utf8')
}
