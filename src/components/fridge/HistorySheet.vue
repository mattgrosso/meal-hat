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
          <span class="history-body">
            <span class="history-what">{{ describe(entry) }}</span>
            <span v-if="entry.detail" class="history-detail">{{ entry.detail }}</span>
          </span>
          <span v-if="source(entry)" class="history-source">{{ source(entry) }}</span>
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
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: #1a1a1a;
  border-radius: 16px;
  padding: 2rem;
  width: 90vw;
  max-width: 440px;
  max-height: 85vh;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.2);
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
    color: #fff;
    font-size: 2rem;
    cursor: pointer;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;

    &:hover {
      background: rgba(255, 255, 255, 0.1);
    }
  }
}

.history-empty {
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.5;
}

.history-day-head {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
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
  border-left: 3px solid rgba(255, 255, 255, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);

  // A glance should separate "something arrived" from "something left".
  &.added { border-left-color: rgba(72, 187, 120, 0.7); }
  &.removed { border-left-color: rgba(245, 101, 101, 0.7); }
  &.extended { border-left-color: rgba(237, 137, 54, 0.7); }
  &.relearned { border-left-color: rgba(120, 160, 245, 0.7); }
}

.history-time {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  // Times are the left rail; a ragged one is hard to read down.
  min-width: 4.2rem;
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
  color: rgba(255, 255, 255, 0.55);
  margin-top: 0.1rem;
}

.history-source {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.35);
  white-space: nowrap;
}
</style>
