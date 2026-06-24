const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || 'https://ai-sales-coach-68ni.onrender.com'

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value)
}

function normalizeUrl(path) {
  if (!path) return ''
  if (isAbsoluteUrl(path)) return path

  const trimmedBase = API_BASE_URL.replace(/\/+$/, '')
  const trimmedPath = String(path).replace(/^\/+/, '')

  if (!trimmedBase) {
    return trimmedPath ? `/${trimmedPath}` : '/'
  }

  return trimmedPath ? `${trimmedBase}/${trimmedPath}` : trimmedBase
}

export function apiUrl(path) {
  return normalizeUrl(path)
}

export async function apiFetch(path, options = {}) {
  return fetch(normalizeUrl(path), {
    credentials: 'include',
    ...options,
  })
}
