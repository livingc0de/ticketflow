const cache = new Map()
export function updateUser(user) {
  const old = cache.get(user.id)
  if (!old) return user
  const updated = { ...old, ...user }
  persist(updated)
  return updated // BUG: cache retains the stale value
}
function persist() {}
