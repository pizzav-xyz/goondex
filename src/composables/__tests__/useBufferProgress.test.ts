import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBufferProgress } from '@/composables/useBufferProgress'
import { useSettingsStore } from '@/stores/settings'
import type { Post } from '@/types'

function makePost(id: number, fileExt = 'mp4'): Post {
  return {
    id,
    source: 'rule34',
    tags: [],
    timestamp: 0,
    rating: 'general',
    score: 0,
    fileExt,
    fileUrl: `https://example.com/${id}.${fileExt}`,
    previewUrl: null,
    sampleUrl: null,
    alternates: [],
    width: 100,
    height: 100,
    sourceUrl: '',
    duration: null,
    uploaderId: null,
    flags: {},
  } as unknown as Post
}

function mockFetchOk(blobContent = 'video-bytes'): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob([blobContent], { type: 'video/mp4' }),
  })))
}

describe('useBufferProgress status transitions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    setActivePinia(createPinia())
    useSettingsStore().setActiveSource('rule34')
    const { clearBuffer } = useBufferProgress()
    clearBuffer()
  })

  it('buffers a video post end-to-end (idle → pending/buffering → buffered)', async () => {
    mockFetchOk()
    const { bufferVideos, getPostStatus, isBuffered, getBufferedUrl } = useBufferProgress()
    const post = makePost(1)

    expect(getPostStatus(post)).toBe('idle')
    const promise = bufferVideos([post], 1)
    const midFlight = getPostStatus(post)
    expect(['pending', 'buffering']).toContain(midFlight)
    await promise
    expect(getPostStatus(post)).toBe('buffered')
    expect(isBuffered(post)).toBe(true)
    const url = getBufferedUrl(post)
    expect(url).toMatch(/^blob:/)
  })

  it('holds later batches in pending while the first batch downloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise<Response>((_, reject) => {
            const err = new DOMException('aborted', 'AbortError')
            if (opts?.signal?.aborted) {
              reject(err)
              return
            }
            opts?.signal?.addEventListener('abort', () => reject(err), { once: true })
          }),
      ),
    )
    const { bufferVideos, getPostStatus, cancelBuffer } = useBufferProgress()
    const posts = [makePost(40), makePost(41), makePost(42), makePost(43)]

    const promise = bufferVideos(posts, 4)
    await Promise.resolve()
    expect(posts.slice(0, 3).map(getPostStatus)).toEqual(['buffering', 'buffering', 'buffering'])
    expect(getPostStatus(posts[3]!)).toBe('pending')
    cancelBuffer()
    await promise
  })

  it('marks non-ok responses as failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const { bufferVideos, getPostStatus } = useBufferProgress()
    const post = makePost(2)

    await bufferVideos([post], 1)
    expect(getPostStatus(post)).toBe('failed')
  })

  it('tracks progress done/total/percent', async () => {
    mockFetchOk()
    const { bufferVideos, progress } = useBufferProgress()
    const posts = [makePost(10), makePost(11), makePost(12)]

    await bufferVideos(posts, 2)
    expect(progress.value.done).toBe(2)
    expect(progress.value.total).toBe(2)
    expect(progress.value.percent).toBe(100)
  })

  it('unbuffer removes a single entry', async () => {
    mockFetchOk()
    const { bufferVideos, unbuffer, isBuffered } = useBufferProgress()
    const post = makePost(20)

    await bufferVideos([post], 1)
    expect(isBuffered(post)).toBe(true)
    unbuffer(post.id)
    expect(isBuffered(post)).toBe(false)
  })

  it('clearBuffer revokes and resets everything', async () => {
    mockFetchOk()
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const { bufferVideos, clearBuffer, bufferedCount, progress } = useBufferProgress()

    await bufferVideos([makePost(30)], 1)
    expect(bufferedCount.value).toBe(1)
    clearBuffer()
    expect(bufferedCount.value).toBe(0)
    expect(progress.value.total).toBe(0)
    expect(progress.value.percent).toBe(0)
    expect(revokeSpy).toHaveBeenCalled()
    revokeSpy.mockRestore()
  })

  it('useVideoBuffer facade exposes the same keys', async () => {
    const { useVideoBuffer } = await import('@/composables/useVideoBuffer')
    const api = useVideoBuffer()
    for (const key of [
      'buffering', 'bufferedCount', 'progress', 'bufferedIds',
      'isBuffered', 'getPostStatus', 'getBufferedUrl',
      'bufferVideos', 'cancelBuffer', 'clearBuffer', 'unbuffer',
    ] as const) {
      expect(api).toHaveProperty(key)
    }
  })
})
