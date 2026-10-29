import { join } from 'node:path'
export function safePath(root, relative) { return join(root, relative) }
