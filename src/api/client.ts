import type { SearchParams } from '@/types'
import type { AutocompleteSuggestion, Post } from '@/sources/types'
import { useActiveSource } from '@/sources/registry'
import { PAGE_SIZE } from '@/config'

/**
 * Dispatcher API client. Every method delegates to the active source's adapter,
 * so this file contains no source-specific URL, parameter, or field name.
 *
 * Rule34 behavior is unchanged: the active source defaults to Rule34, and that
 * adapter keeps the same endpoints, wire parameters, and error detection. The
 * one intentional wire change is that `rating=` is never sent — filtering rides
 * on `rating:` search terms.
 *
 * Query translation is deliberately NOT done here: the adapter owns it, through
 * the one shared normalizer. Normalizing in both places would double-translate
 * — this layer would emit e621's `rating:e`, which the adapter would then
 * reject as unrecognized and drop, silently returning an unfiltered grid.
 *
 * Caching also lives in the adapter, keyed by source and by the exact upstream
 * request. A cache here would hold the same responses under a second, looser key
 * that can disagree with the adapter's about what was fetched.
 */

export { PAGE_SIZE }

export class APIClient {
  /**
   * Runs a search on the active source and returns canonical posts.
   *
   * `tags` and `ratings` are the app-facing inputs; they are assembled into one
   * canonical query and handed to the adapter, which translates it. A rating
   * the target source cannot express is reported through the adapter's dropped
   * list rather than approximated — reaching the reporting layer in §6.3.
   */
  async search({
    tags = '',
    page = 0,
    limit = PAGE_SIZE,
    ratings,
  }: SearchParams = {}): Promise<Post[]> {
    const terms: string[] = []
    if (tags.trim()) terms.push(tags.trim())
    for (const rating of ratings ?? []) {
      terms.push(`rating:${rating}`)
    }

    const { posts } = await useActiveSource().value.search({
      query: terms.join(' '),
      page,
      limit,
    })
    // Copied because the canonical shape is readonly while the app-facing
    // `Post[]` this returns has always been a mutable array.
    return [...posts]
  }

  async autocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    const trimmed = query.trim()
    if (!trimmed) return []
    return useActiveSource().value.autocomplete(trimmed)
  }

  async postDetail(id: number): Promise<Post> {
    return useActiveSource().value.postDetail(id)
  }
}

export const apiClient = new APIClient()