// Listing photos: Blobs in IndexedDB (never localStorage), keyed by the ids in
// Listing.photoIds. Uploads are canvas-re-encoded (apartment photos don't need
// originals) so the export bundle stays shippable. The data-URI helpers are the
// trust boundary for bundle import — a bundle is just a file someone sends you.
import { createStore, del, get, keys, set } from 'idb-keyval'

// Lazy: createStore touches indexedDB, which doesn't exist during static build.
let _store: ReturnType<typeof createStore> | null = null
function store() {
  return (_store ??= createStore('moveday-photos', 'photos'))
}

export const MAX_PHOTOS_PER_LISTING = 12
// ~1.5 MB of binary ≈ 2M base64 chars — the §3 cap for bundle portability.
export const MAX_PHOTO_DATA_URI_CHARS = 2_100_000
const RE_ENCODE_MAX_DIM = 1600
const RE_ENCODE_QUALITY = 0.82

const IMAGE_DATA_URI = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+=*)$/

export function newPhotoId(): string {
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Pure data-URI helpers (exported for tests) ──────────────────────────────

/** Strictly validate an image data URI (MIME allowlist + base64 + size cap). */
export function isImageDataUri(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_PHOTO_DATA_URI_CHARS && IMAGE_DATA_URI.test(v)
}

export function dataUriToBlob(uri: string): Blob | null {
  const m = typeof uri === 'string' ? uri.match(IMAGE_DATA_URI) : null
  if (!m || uri.length > MAX_PHOTO_DATA_URI_CHARS) return null
  try {
    const bin = atob(m[2])
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    return new Blob([buf], { type: m[1] })
  } catch {
    return null
  }
}

export async function blobToDataUri(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`
}

/**
 * The photos block of an export bundle ({photoId: dataUri}) — but incoming
 * bundles are untrusted files, so keep only well-formed ids mapping to strict
 * image data URIs, capped in count. Everything else is silently dropped.
 */
export function validateBundlePhotos(raw: unknown, maxCount = 200): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  let n = 0
  for (const [id, uri] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= maxCount) break
    if (typeof id !== 'string' || !id || id.length > 80) continue
    if (!isImageDataUri(uri)) continue
    out[id] = uri
    n++
  }
  return out
}

// ── IndexedDB operations (browser only) ─────────────────────────────────────

export async function putPhotoBlob(id: string, blob: Blob): Promise<void> {
  await set(id, blob, store())
}

export async function getPhotoBlob(id: string): Promise<Blob | null> {
  try {
    const v = await get(id, store())
    return v instanceof Blob ? v : null
  } catch {
    return null
  }
}

export async function deletePhotos(ids: string[]): Promise<void> {
  await Promise.allSettled(ids.map((id) => del(id, store())))
}

/** Delete stored photos no hunt listing references (post-import / crash tidy). */
export async function sweepOrphanPhotos(referencedIds: string[]): Promise<void> {
  try {
    const referenced = new Set(referencedIds)
    const all = (await keys(store())) as string[]
    const orphans = all.filter((k) => typeof k === 'string' && !referenced.has(k))
    if (orphans.length > 0) await deletePhotos(orphans)
  } catch {
    /* best effort */
  }
}

// Re-encode an upload: fit within RE_ENCODE_MAX_DIM, JPEG. Falls back to the
// original file if decoding fails (e.g. HEIC in an unsupporting browser) but
// only when the original is already under the bundle cap.
async function reEncode(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, RE_ENCODE_MAX_DIM / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', RE_ENCODE_QUALITY),
    )
    return blob
  } catch {
    return null
  }
}

/** Store an uploaded image (re-encoded). Returns the new photo id, or null. */
export async function addPhotoFromFile(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  let blob = await reEncode(file)
  if (!blob) {
    // Couldn't decode — keep the original only if it's bundle-sized already.
    if (file.size <= MAX_PHOTO_DATA_URI_CHARS * 0.74) blob = file
    else return null
  }
  const id = newPhotoId()
  await putPhotoBlob(id, blob)
  return id
}

/** Store a photo arriving in an import bundle (already validated). */
export async function addPhotoFromDataUri(id: string, uri: string): Promise<boolean> {
  const blob = dataUriToBlob(uri)
  if (!blob) return false
  await putPhotoBlob(id, blob)
  return true
}
