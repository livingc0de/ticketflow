const cache = new Map()
export function updateUser(user) {
  const old = cache.get(user.id)
  if (!old) return user
  const updated = { ...old, ...user }
  persist(updated)
  return updated
}
function persist() {}

export function readUser(id, load) {
  if (!cache.has(id)) cache.set(id, load(id))
  return cache.get(id)
}
