<template>
  <!-- The wall when there is an idea to show: the poster, and under it one
       quiet line of what needs eating soon. The line is also the door back to
       the timers the wall has always shown: nothing was taken away, it moved
       one tap down. -->
  <div class="idea-wall">
    <IdeaPoster
      :idea="shown.idea"
      :day="shown.day"
      :today="shown.today"
      :timers="timers"
      :now="now"
    />

    <button type="button" class="soon-strip" @click="$emit('timers')">
      <span class="soon-label">Eat soon</span>
      <span class="soon-items">
        <span v-for="item in soonItems" :key="item.id" class="soon-item" :class="{ past: item.past }">
          {{ item.title }}<span class="soon-left">{{ item.left }}</span>
        </span>
        <span v-if="!soonItems.length" class="soon-item none">Nothing just now</span>
      </span>
      <span class="soon-open">Timers ›</span>
    </button>
  </div>
</template>

<script>
import IdeaPoster from './IdeaPoster.vue'
import { computeTimeLeft } from '@/store/fridge/timers'

export default {
  name: 'IdeaWall',
  components: { IdeaPoster },
  props: {
    // { day, idea, today } from ideaToShow.
    shown: { type: Object, required: true },
    // Every timer, pantry included, for the poster.
    timers: { type: Array, default: () => [] },
    // The cards the timers wall would be showing right now (wallTimers).
    soon: { type: Array, default: () => [] },
    now: { type: Number, default: () => Date.now() }
  },
  emits: ['timers'],
  computed: {
    soonItems () {
      const now = new Date(this.now)
      return this.soon.map((timer) => {
        const left = computeTimeLeft(timer.expiryDate, now)
        return {
          id: timer.id,
          title: timer.title,
          past: left.expired,
          left: left.expired
            ? 'past'
            : left.days === 0
              ? 'today'
              : left.days === 1 ? '1 day' : `${left.days} days`
        }
      })
    }
  }
}
</script>

<style lang="scss" scoped>
/* The wall's page has 16px of padding all round (Fridge.vue), and this fills
 * what is left exactly: a poster does not scroll. */
.idea-wall {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 32px);
  height: calc(100dvh - 32px);
}

.soon-strip {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: min(2.4vw, 3.6vh);
  width: 100%;
  margin-bottom: 10px;
  padding: min(1.5vw, 2.2vh) max(60px, min(4vw, 6vh)) min(1.2vw, 1.8vh);
  background: none;
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.16);
  color: #fff;
  font-family: inherit;
  font-size: clamp(0.9rem, min(1.5vw, 2.5vh), 1.3rem);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.soon-label,
.soon-open {
  flex: none;
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.78em;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.5;
}

/* One line, and whole names only: what does not fit wraps to a second line
 * that is not shown, so nothing is ever cut off mid-word. */
.soon-items {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.6em;
  height: 1.4em;
  line-height: 1.4;
  overflow: hidden;
}

.soon-item {
  white-space: nowrap;
  opacity: 0.8;

  &.past {
    opacity: 1;
  }

  &.none {
    opacity: 0.45;
  }
}

.soon-left {
  margin-left: 0.55em;
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.74em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.6;
}
</style>
