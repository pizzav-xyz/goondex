import { ref } from 'vue'
import type { Post } from '@/types'
import type { APIClient } from '@/api/client'
import type { useWatchedStore } from '@/stores/watched'
import type SearchBar from '@/components/SearchBar.vue'

interface UseLightboxOptions {
  api: APIClient
  watched: ReturnType<typeof useWatchedStore>
  searchBarRef: ReturnType<typeof ref<InstanceType<typeof SearchBar> | null>>
}

export function useLightbox({ api, watched, searchBarRef }: UseLightboxOptions) {
  const showLightbox = ref(false)
  const lightboxPost = ref<Post | null>(null)
  const lightboxPosts = ref<Post[]>([])

  function openLightbox(post: Post, all: Post[]) {
    lightboxPost.value = { ...post }
    lightboxPosts.value = all
    showLightbox.value = true
    watched.addWatched(post.source, post.id)
    watched.setLightboxPost(post, null)
  }

  function closeLightbox(playbackTime: number | null) {
    if (lightboxPost.value) {
      watched.setLightboxPost(lightboxPost.value, playbackTime)
    }
    showLightbox.value = false
    lightboxPost.value = null
  }

  function handleLightboxTagClick(tag: string) {
    showLightbox.value = false
    lightboxPost.value = null
    searchBarRef.value?.addTagAndSearch(tag)
  }

  function handleLightboxOpen(post: Post) {
    lightboxPost.value = { ...post }
    watched.addWatched(post.source, post.id)
  }

  function handleToggleWatch(post: Post) {
    watched.toggleWatched(post.source, post.id)
  }

  function isWatched(post: Post): boolean {
    return watched.isWatched(post.source, post.id)
  }

  async function fetchPostDetails(id: number) {
    try {
      const posts = await api.search({ tags: `id:${id}`, limit: 1 })
      if (posts.length && lightboxPost.value?.id === id) {
        Object.assign(lightboxPost.value, posts[0])
      }
    } catch (err) {
      console.error('Failed to fetch post details:', err)
    }
  }

  return {
    showLightbox,
    lightboxPost,
    lightboxPosts,
    openLightbox,
    closeLightbox,
    handleLightboxTagClick,
    handleLightboxOpen,
    handleToggleWatch,
    isWatched,
    fetchPostDetails,
  }
}
