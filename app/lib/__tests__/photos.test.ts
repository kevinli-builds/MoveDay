import { describe, expect, it } from 'vitest'

import {
  blobToDataUri,
  dataUriToBlob,
  isImageDataUri,
  MAX_PHOTO_DATA_URI_CHARS,
  validateBundlePhotos,
} from '../photos'

// A real 1×1 JPEG, base64.
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='

describe('isImageDataUri (bundle trust boundary)', () => {
  it('accepts a real image data URI', () => {
    expect(isImageDataUri(TINY_JPEG)).toBe(true)
  })

  it('rejects non-image MIME types (script smuggling)', () => {
    expect(isImageDataUri('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isImageDataUri('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false) // SVG can script
    expect(isImageDataUri('data:application/javascript;base64,YWxlcnQoMSk=')).toBe(false)
  })

  it('rejects non-base64 payloads and non-strings', () => {
    expect(isImageDataUri('data:image/png;base64,not!!valid@@')).toBe(false)
    expect(isImageDataUri('javascript:alert(1)')).toBe(false)
    expect(isImageDataUri(42)).toBe(false)
    expect(isImageDataUri(null)).toBe(false)
  })

  it('rejects oversized URIs (bundle cap)', () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(MAX_PHOTO_DATA_URI_CHARS)}`
    expect(isImageDataUri(huge)).toBe(false)
  })
})

describe('dataUriToBlob / blobToDataUri', () => {
  it('round-trips an image', async () => {
    const blob = dataUriToBlob(TINY_JPEG)
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe('image/jpeg')
    const back = await blobToDataUri(blob!)
    expect(back).toBe(TINY_JPEG)
  })

  it('returns null for anything the validator rejects', () => {
    expect(dataUriToBlob('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
    expect(dataUriToBlob('nonsense')).toBeNull()
  })
})

describe('validateBundlePhotos', () => {
  it('keeps only valid entries from a hostile bundle', () => {
    const out = validateBundlePhotos({
      good: TINY_JPEG,
      script: 'data:text/html;base64,PHNjcmlwdD4=',
      svg: 'data:image/svg+xml;base64,PHN2Zz4=',
      notAString: 7,
      '': TINY_JPEG, // empty id
      [`x${'y'.repeat(100)}`]: TINY_JPEG, // absurd id length
    })
    expect(Object.keys(out)).toEqual(['good'])
  })

  it('handles non-object inputs', () => {
    expect(validateBundlePhotos(null)).toEqual({})
    expect(validateBundlePhotos('str')).toEqual({})
    expect(validateBundlePhotos([TINY_JPEG])).toEqual({})
  })

  it('caps the photo count', () => {
    const raw: Record<string, string> = {}
    for (let i = 0; i < 10; i++) raw[`p${i}`] = TINY_JPEG
    expect(Object.keys(validateBundlePhotos(raw, 3))).toHaveLength(3)
  })
})
