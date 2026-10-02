<script setup lang="ts">
const emit = defineEmits<{
  tagClick: [tag: string]
}>()

const DATE_PRESETS = [
  { label: '24h', value: 'day' },
  { label: '2d', value: '2day' },
  { label: '3d', value: '3day' },
  { label: '1w', value: 'week' },
  { label: '2w', value: '2week' },
  { label: '1m', value: 'month' },
  { label: '1y', value: 'year' },
] as const

function addTagAndSearch(tag: string) {
  emit('tagClick', tag)
}
</script>

<template>
  <div class="search-syntax">
    <!-- Tags Section -->
    <div class="syntax-section">
      <div class="syntax-section-title">Tags</div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="tag1 tag2" @click.prevent="addTagAndSearch('tag1 tag2')">
          <code>tag1 tag2</code>
        </button>
        <span>Search for posts that have <b>tag1</b> and <b>tag2</b>.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="night~" @click.prevent="addTagAndSearch('night~')">
          <code>night~</code>
        </button>
        <span>Fuzzy search for <b>night</b> &mdash; returns results like fight, bright, light, etc.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="tag1 ( tag2 ~ tag3 ~ tag4 )" @click.prevent="addTagAndSearch('tag1 ( tag2 ~ tag3 ~ tag4 )')">
          <code>tag1 ( tag2 ~ tag3 ~ tag4 )</code>
        </button>
        <span>Posts with <b>tag1</b> but also <b>tag2</b> OR <b>tag3</b> OR <b>tag4</b>.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="-tag1" @click.prevent="addTagAndSearch('-tag1')">
          <code>-tag1</code>
        </button>
        <span>Exclude posts that have <b>tag1</b>.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="tag1*" @click.prevent="addTagAndSearch('tag1*')">
          <code>tag1*</code>
        </button>
        <span>Tags that <b>begin with</b> tag1.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="*tag1" @click.prevent="addTagAndSearch('*tag1')">
          <code>*tag1</code>
        </button>
        <span>Tags that <b>end with</b> tag1.</span>
      </div>
    </div>

    <!-- Metatags Section -->
    <div class="syntax-section">
      <div class="syntax-section-title">Metatags</div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="user:bob" @click.prevent="addTagAndSearch('user:bob')">
          <code>user:bob</code>
        </button>
        <span>Posts uploaded by user <b>Bob</b>.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="md5:foo" @click.prevent="addTagAndSearch('md5:foo')">
          <code>md5:foo</code>
        </button>
        <span>Posts with MD5 hash <b>foo</b>.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="md5:foo*" @click.prevent="addTagAndSearch('md5:foo*')">
          <code>md5:foo*</code>
        </button>
        <span>Posts whose MD5 <b>starts with</b> foo.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="rating:questionable" @click.prevent="addTagAndSearch('rating:questionable')">
          <code>rating:questionable</code>
        </button>
        <span>Posts rated <b>questionable</b>.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="-rating:questionable" @click.prevent="addTagAndSearch('-rating:questionable')">
          <code>-rating:questionable</code>
        </button>
        <span>Posts that are <b>not</b> rated questionable.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="width:>=1000 height:>1000" @click.prevent="addTagAndSearch('width:>=1000 height:>1000')">
          <code>width:&gt;=1000 height:&gt;1000</code>
        </button>
        <span>Width &ge; 1000 <b>and</b> height &gt; 1000.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="score:>=10" @click.prevent="addTagAndSearch('score:>=10')">
          <code>score:&gt;=10</code>
        </button>
        <span>Posts with score &ge; 10 (updated daily at 12AM CST).</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="fav:1" @click.prevent="addTagAndSearch('fav:1')">
          <code>fav:1</code>
        </button>
        <span>Posts favorited by user <b>id 1</b>.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="pool:2" @click.prevent="addTagAndSearch('pool:2')">
          <code>pool:2</code>
        </button>
        <span>Posts in pool <b>id 2</b>.</span>
      </div>
    </div>

    <!-- Date Filtering Section -->
    <div class="syntax-section">
      <div class="syntax-section-title">Date Filtering</div>
      <div
        v-for="dp in DATE_PRESETS"
        :key="dp.value"
        class="syntax-row"
      >
        <span>Posts from the <b>last {{ dp.label }}</b>.</span>
      </div>
    </div>

    <!-- Duration Filtering Section -->
    <div class="syntax-section">
      <div class="syntax-section-title">Duration Filtering</div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="duration:>30" @click.prevent="addTagAndSearch('duration:>30')">
          <code>duration:&gt;30</code>
        </button>
        <span>Videos <b>longer than</b> 30 seconds.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="duration:>=60" @click.prevent="addTagAndSearch('duration:>=60')">
          <code>duration:&gt;=60</code>
        </button>
        <span>Videos <b>60 seconds or longer</b>.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="duration:<120" @click.prevent="addTagAndSearch('duration:<120')">
          <code>duration:&lt;120</code>
        </button>
        <span>Videos <b>shorter than</b> 120 seconds.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="duration:31" @click.prevent="addTagAndSearch('duration:31')">
          <code>duration:31</code>
        </button>
        <span>Videos <b>exactly</b> 31 seconds.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="duration:30-60" @click.prevent="addTagAndSearch('duration:30-60')">
          <code>duration:30-60</code>
        </button>
        <span>Videos between <b>30 and 60</b> seconds.</span>
      </div>
      <div class="syntax-row syntax-note">
        <span>
          Durations are probed in your browser, so <b>posts with no known
          duration — including images — are excluded</b> while a duration filter
          is active. This is deliberate: an unknown duration cannot satisfy any
          comparison.
        </span>
      </div>
    </div>

    <!-- Sorting Section -->
    <div class="syntax-section">
      <div class="syntax-section-title">Sorting</div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="sort:random" @click.prevent="addTagAndSearch('sort:random')">
          <code>sort:random</code>
        </button>
        <span>Random order on every refresh.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="sort:random:3456" @click.prevent="addTagAndSearch('sort:random:3456')">
          <code>sort:random:3456</code>
        </button>
        <span>Seeded random (0&ndash;10000) to persist results across refreshes.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="sort:updated:desc" @click.prevent="addTagAndSearch('sort:updated:desc')">
          <code>sort:updated:desc</code>
        </button>
        <span>Order by most recently updated.</span>
      </div>
      <div class="syntax-row">
        <button class="syntax-code-btn" data-tag="sort:score:asc" @click.prevent="addTagAndSearch('sort:score:asc')">
          <code>sort:score:asc</code>
        </button>
        <span>Sort options: <b>id</b>, <b>score</b>, <b>rating</b>, <b>user</b>, <b>height</b>, <b>width</b>, <b>source</b>, <b>updated</b>. Use <b>asc</b> or <b>desc</b>.</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-syntax {
  margin-top: 12px;
  max-width: 1200px;
  margin-inline: auto;
  background: var(--md-surface-container-low);
  border: 1px solid var(--md-outline-variant);
  border-radius: var(--md-shape-md);
  padding: 16px;
}

.syntax-section {
  margin-bottom: 12px;
}

.syntax-section:last-child {
  margin-bottom: 0;
}

.syntax-section-title {
  font-family: var(--md-font-brand);
  font-size: 13px;
  font-weight: 500;
  color: var(--md-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.syntax-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  font-size: 13px;
  color: var(--md-on-surface-variant);
  line-height: 1.5;
}

.syntax-note {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--md-outline-variant);
  font-size: 12px;
}

.syntax-row code {
  flex-shrink: 0;
  font-family: "Roboto Mono", monospace;
  font-size: 12px;
  color: var(--md-on-surface);
  background: var(--md-surface-container-highest);
  padding: 2px 8px;
  border-radius: var(--md-shape-xs);
  white-space: nowrap;
  transition: background var(--md-motion-fast) var(--md-motion-standard),
              box-shadow var(--md-motion-fast) var(--md-motion-standard);
}

.syntax-code-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
  border-radius: var(--md-shape-xs);
  transition: all var(--md-motion-fast) var(--md-motion-standard);
}

.syntax-code-btn:hover code {
  background: color-mix(in srgb, var(--md-primary) 12%, var(--md-surface-container-highest));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--md-primary) 24%, transparent);
}

.syntax-code-btn:active {
  transform: scale(0.97);
}

.syntax-code-btn:focus-visible {
  outline: none;
  box-shadow: var(--md-focus-ring);
  border-radius: var(--md-shape-xs);
}

.syntax-row .date-chip {
  height: 28px;
  font-size: 12px;
}

.syntax-row b {
  color: var(--md-on-surface);
  font-weight: 500;
}

@media (max-width: 639px) {
  .syntax-row {
    flex-wrap: wrap;
    gap: 4px 8px;
  }
}
</style>
