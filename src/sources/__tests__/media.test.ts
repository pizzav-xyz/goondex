import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isVideo, getMediaUrl, getThumbnailUrl, hasVideoSupport } from '@/sources/media'
import { useSettingsStore } from '@/stores/settings'
import type { Post } from '@/sources/types'

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 1,
    source: 'rule34',
    tags: [],
    timestamp: 0,
    rating: 'explicit',
    score: 0,
    fileExt: 'png',
    fileUrl: 'https://file/1.png',
    previewUrl: 'https://preview/1.png',
    sampleUrl: 'https://sample/1.jpg',
    alternates: [],
    width: 100,
    height: 100,
    sourceUrl: '',
    duration: null,
    uploaderId: null,
    uploaderName: '',
    approverId: null,
    flags: {},
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('isVideo per source', () => {
  it('treats webm as video on e621 but not on Rule34', () => {
    const post = makePost({ source: 'e621', fileExt: 'webm' })
    useSettingsStore().setActiveSource('e621')
    expect(isVideo(post)).toBe(true)
    useSettingsStore().setActiveSource('rule34')
    expect(isVideo(post)).toBe(false)
  })

  it('treats gif as video on Rule34 but not on e621', () => {
    const post = makePost({ source: 'rule34', fileExt: 'gif' })
    useSettingsStore().setActiveSource('rule34')
    expect(isVideo(post)).toBe(true)
    useSettingsStore().setActiveSource('e621')
    expect(isVideo(post)).toBe(false)
  })

  it('treats mp4 as video on both sources', () => {
    const post = makePost({ fileExt: 'mp4' })
    useSettingsStore().setActiveSource('rule34')
    expect(isVideo(post)).toBe(true)
    useSettingsStore().setActiveSource('e621')
    expect(isVideo(post)).toBe(true)
  })

  it('never treats a still image as video on either source', () => {
    const post = makePost({ fileExt: 'png' })
    for (const id of ['rule34', 'e621'] as const) {
      useSettingsStore().setActiveSource(id)
      expect(isVideo(post)).toBe(false)
    }
  })
})

describe('getMediaUrl fallback order', () => {
  it('prefers sample then file then preview for an image', () => {
    useSettingsStore().setActiveSource('rule34')
    expect(getMediaUrl(makePost())).toBe('https://sample/1.jpg')
    expect(
      getMediaUrl(makePost({ sampleUrl: null })),
    ).toBe('https://file/1.png')
    expect(
      getMediaUrl(makePost({ sampleUrl: null, fileUrl: null })),
    ).toBe('https://preview/1.png')
  })

  it('returns null when every media field is null', () => {
    useSettingsStore().setActiveSource('e621')
    expect(
      getMediaUrl(
        makePost({ sampleUrl: null, fileUrl: null, previewUrl: null }),
      ),
    ).toBeNull()
  })

  it('terminates a video at sampleUrl, skipping preview', () => {
    useSettingsStore().setActiveSource('rule34')
    expect(getMediaUrl(makePost({ fileExt: 'gif', sampleUrl: null }))).toBe(
      'https://file/1.png',
    )
    expect(
      getMediaUrl(makePost({ fileExt: 'gif', fileUrl: null, sampleUrl: null })),
    ).toBeNull()
  })
})

describe('getThumbnailUrl never returns a video file for a grid tile', () => {
  it('uses the preview for a Rule34 gif, not the gif file itself', () => {
    useSettingsStore().setActiveSource('rule34')
    const post = makePost({ fileExt: 'gif' })
    expect(getMediaUrl(post)).toBe('https://file/1.png')
    expect(getThumbnailUrl(post)).toBe('https://preview/1.png')
  })

  it('uses the preview for an e621 webm, not the webm file itself', () => {
    useSettingsStore().setActiveSource('e621')
    const post = makePost({ source: 'e621', fileExt: 'webm' })
    expect(getMediaUrl(post)).toBe('https://file/1.png')
    expect(getThumbnailUrl(post)).toBe('https://preview/1.png')
  })

  it('falls back to the sample when a video has no preview', () => {
    useSettingsStore().setActiveSource('e621')
    const post = makePost({ source: 'e621', fileExt: 'webm', previewUrl: null })
    expect(getThumbnailUrl(post)).toBe('https://sample/1.jpg')
  })

  it('keeps the image chain as sample, preview, file', () => {
    useSettingsStore().setActiveSource('rule34')
    expect(getThumbnailUrl(makePost())).toBe('https://sample/1.jpg')
    expect(
      getThumbnailUrl(makePost({ sampleUrl: null })),
    ).toBe('https://preview/1.png')
    expect(
      getThumbnailUrl(makePost({ sampleUrl: null, previewUrl: null })),
    ).toBe('https://file/1.png')
  })
})

describe('hasVideoSupport', () => {
  it('is true for both registered sources', () => {
    for (const id of ['rule34', 'e621'] as const) {
      useSettingsStore().setActiveSource(id)
      expect(hasVideoSupport()).toBe(true)
    }
  })
})