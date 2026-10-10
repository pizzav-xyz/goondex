<script setup lang="ts">
import { computed } from 'vue'
import { isVideo } from '@/sources/media'
import { useBufferProgress } from '@/composables/useBufferProgress'
import type { Post } from '@/types'

const props = defineProps<{
  post: Post
}>()

const { getPostStatus } = useBufferProgress()
const status = computed(() => getPostStatus(props.post))
const visible = computed(() => isVideo(props.post) && status.value !== 'idle')
</script>

<template>
  <span
    v-if="visible"
    class="buffer-badge"
    :class="`buffer-${status}`"
    :title="status"
  >
    <v-icon v-if="status === 'buffered'" icon="offline_pin" size="14" />
    <v-icon v-else-if="status === 'failed'" icon="error" size="14" />
    <v-icon v-else icon="downloading" size="14" class="spinning" />
  </span>
</template>

<style scoped>
.buffer-badge {
  position: absolute;
  bottom: 8px;
  left: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.65);
  color: white;
}

.buffer-badge.buffer-buffered {
  color: #4caf50;
}

.buffer-badge.buffer-failed {
  color: #f44336;
}

.buffer-badge .spinning {
  animation: buffer-spin 1s linear infinite;
}

@keyframes buffer-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>