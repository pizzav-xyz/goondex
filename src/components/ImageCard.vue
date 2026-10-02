<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Post } from '@/types'

const props = defineProps<{
  post: Post
  watched: boolean
  watchedMode: 'show' | 'dim' | 'hide'
}>()

const emit = defineEmits<{
  click: [post: Post]
}>()

const img = computed(() => props.post.sampleUrl || props.post.previewUrl || '')
const tags = computed(() => props.post.tags.slice(0, 6))
const isVideo = computed(() => props.post.fileExt === 'webm' || props.post.fileExt === 'mp4')
const isDimmed = computed(() => props.watched && props.watchedMode === 'dim')
const imgFailed = ref(false)

function onImgError() {
  imgFailed.value = true
}
</script>

<template>
  <div class="image-card" :class="{ 'image-card-watched': isDimmed }" @click="emit('click', post)">
    <img v-if="!imgFailed" :src="img" alt="" loading="lazy" @error="onImgError" />
    <div v-if="isVideo" class="image-card-play">
      <v-icon icon="play_circle" size="48" color="white" />
    </div>
    <div v-if="watched && watchedMode === 'dim'" class="image-card-watched-badge">
      <v-icon icon="check_circle" size="18" color="#4caf50" />
    </div>
    <span v-if="post.score != null" class="image-card-score">
      <v-icon icon="arrow_upward" size="14" /> {{ post.score }}
    </span>
    <span
      v-if="post.rating"
      class="image-card-rating"
      :class="post.rating"
    >
      {{ post.rating }}
    </span>
    <span v-if="isVideo" class="image-card-ext">{{ post.fileExt?.toUpperCase() }}</span>
    <div class="image-card-overlay">
      <div class="image-card-tags">
        <span v-for="t in tags" :key="t" class="image-card-tag">{{ t }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: var(--v-surface-container);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  aspect-ratio: 1;
}

.image-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 6px 2px rgba(0, 0, 0, 0.15);
}

.image-card-watched {
  filter: brightness(0.6) grayscale(0.4);
}

.image-card-watched:hover {
  filter: brightness(0.75) grayscale(0.2);
}

.image-card-watched-badge {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 9999px;
  pointer-events: none;
}

.image-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.image-card-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7) 0%, transparent 50%);
  opacity: 0;
  transition: opacity 0.15s;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 10px;
  pointer-events: none;
}

.image-card:hover .image-card-overlay {
  opacity: 1;
}

.image-card-score {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 4px;
  color: white;
  font-size: 12px;
  font-weight: 500;
}

.image-card-rating {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  color: white;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.image-card-rating.general {
  background: #388e3c;
}

.image-card-rating.sensitive {
  background: #fbc02d;
  color: #000;
}

.image-card-rating.questionable {
  background: #ff7043;
}

.image-card-rating.explicit {
  background: #d32f2f;
}

.image-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 40px;
  overflow: hidden;
}

.image-card-tag {
  display: inline-block;
  padding: 1px 6px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 10px;
  line-height: 1.5;
  white-space: nowrap;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.image-card-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.image-card-ext {
  position: absolute;
  bottom: 8px;
  right: 8px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 4px;
  color: white;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}
</style>
