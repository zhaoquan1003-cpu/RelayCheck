const KEY = 'relaycheck-my-tests'
const ID_RE = /^[a-f0-9]{16}$/

export function loadMyTests(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && ID_RE.test(id)))]
  } catch {
    return []
  }
}

export function addMyTest(id: string): string[] {
  const ids = loadMyTests().filter((value) => value !== id)
  ids.push(id)
  const trimmed = ids.slice(-100)
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    // Storage may be unavailable in private mode. The share link still works.
  }
  return trimmed
}

export function removeMyTest(id: string): string[] {
  const ids = loadMyTests().filter((value) => value !== id)
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // ignore
  }
  return ids
}