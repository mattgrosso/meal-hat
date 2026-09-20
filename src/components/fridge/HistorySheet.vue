<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content history-content">
      <div class="modal-header">
        <h2>What's changed</h2>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>

      <p v-if="!sections.length" class="history-empty">
        Nothing logged yet. Every timer added, removed, extended, or re-learned
        from here on shows up in this list.
      </p>

      <div v-for="section in sections" :key="section.label" class="history-day">
        <h3 class="history-day-head">{{ section.label }}</h3>
        <div
          v-for="entry in section.entries"
          :key="entry.id"
          class="history-row"
          :class="entry.action"
        >
          <span class="history-time">{{ time(entry) }}</span>
          <!-- The source sits UNDER the detail, not beside it. As a third
               column it squeezed the middle one down to a word a line on a
               phone ("Re- / learned / Potatoes"). -->
          <span class="history-body">
            <span class="history-what">{{ describe(entry) }}</span>
            <span v-if="entry.detail" class="history-detail">{{ entry.detail }}</span>
            <span v-if="source(entry)" class="history-source">{{ source(entry) }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// The change log, newest first, headed by day. Read-only on purpose: this
// answers "where did that timer come from?", it doesn't offer to undo it.
import { groupByDay, describeEntry, describeSource, entryTime } from '@/store/fridge/history'

export default {
  name: 'HistorySheet',
  emits: ['close'],
  computed: {
    sections () {
      return groupByDay(this.$store.getters['fridge/history'], new Date())
    }
  },
  methods: {
    time (entry) {
      return entryTime(entry.at)
    },
    describe (entry) {
      return describeEntry(entry)
    },
    source (entry) {
      return describeSource(entry)
    }
  }
}
</script>

<style lang="scss" scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  /* iOS: `100vh` is the LARGE viewport — the height the page would have if
     the browser toolbars were hidden — so a bottom-aligned sheet is measured
     against a box taller than what you can actually see, and its last rows sit
     underneath the toolbar. Matt, 2026-09-20: "the bottom edge is getting cut
     off... we need to figure out how to make sure that doesn't happen across
     all these screens." `dvh` tracks the visible area. The `vh` line stays as
     the fallback for anything that doesn't know `dvh`. */
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  background: var(--fr-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--fr-surface);
  border-radius: 16px;
  padding: 2rem;
  width: 90vw;
  max-width: 440px;
  max-height: 85vh;
  overflow-y: auto;
  border: 1px solid var(--fr-line);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;

  h2 {
    font-size: 1.5rem;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--fr-text);
    font-size: 2rem;
    cursor: pointer;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;

    &:hover {
      background: var(--fr-field);
    }
  }
}

.history-empty {
  color: var(--fr-muted);
  line-height: 1.5;
}

.history-day-head {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fr-faint);
  margin: 1.25rem 0 0.5rem;
}

.history-day:first-child .history-day-head {
  margin-top: 0;
}

.history-row {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.5rem 0 0.5rem 0.6rem;
  border-left: 3px solid var(--fr-line);
  border-bottom: 1px solid var(--fr-line);

  // A glance should separate "something arrived" from "something left".
  &.added { border-left-color: rgba(72, 187, 120, 0.7); }
  &.removed { border-left-color: rgba(245, 101, 101, 0.7); }
  &.extended { border-left-color: rgba(237, 137, 54, 0.7); }
  &.relearned { border-left-color: rgba(120, 160, 245, 0.7); }
}

.history-time {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.7rem;
  color: var(--fr-faint);
  white-space: nowrap;
  // Times are the left rail; a ragged one is hard to read down. Sized to
  // "12:00 PM" and no wider — the rail was 4.2rem, a third of a phone row.
  min-width: 3.6rem;
}

.history-body {
  flex: 1;
  min-width: 0;
}

.history-what {
  display: block;
  font-size: 0.95rem;
}

.history-detail {
  display: block;
  font-size: 0.8rem;
  color: var(--fr-muted);
  margin-top: 0.1rem;
}

.history-source {
  display: block;
  font-size: 0.75rem;
  color: var(--fr-faint);
  margin-top: 0.15rem;
}
</style>
