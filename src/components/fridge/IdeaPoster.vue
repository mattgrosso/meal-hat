<template>
  <!-- TODAY'S IDEA on the wall (2026-11-09). One thing to cook today from what
       is in the house: see aws-lambda/idea.js for what Matt and Carrie asked
       for. A poster, not a card: it is read from across the kitchen, it does
       not move, and the only colour on it is the day's one swatch. Tap it for
       how to make the thing; tap again to put it back. -->
  <div
    class="idea-poster"
    :class="{ how: showHow }"
    :style="{ '--swatch': swatch }"
    role="button"
    tabindex="0"
    @click="toggle"
    @keydown.enter="toggle"
  >
    <div class="idea-top">
      <span class="idea-label"><span class="idea-dot"></span>{{ label }}</span>
      <span class="idea-date">{{ showHow ? 'Tap to close' : dateLabel }}</span>
    </div>

    <!-- The front: the name, big. -->
    <template v-if="!showHow">
      <div class="idea-middle">
        <h1 class="idea-name" :class="nameSize">{{ idea.name }}</h1>
        <p v-if="idea.line" class="idea-line">{{ idea.line }}</p>
      </div>

      <div class="idea-foot">
        <span v-if="idea.minutes" class="idea-minutes">{{ idea.minutes }} min</span>
        <p class="idea-uses">
          <span class="idea-uses-label">Uses</span>
          <span
            v-for="item in usesShown"
            :key="item.listName"
            class="idea-use"
            :class="{ soon: item.soon, gone: item.gone }"
          >{{ sayName(item.name) }}<span v-if="item.soon && !item.gone" class="idea-use-left">{{ formatSoon(item.daysLeft) }}</span></span>
          <span v-if="usesHidden" class="idea-use more">and {{ usesHidden }} more</span>
        </p>
        <span class="idea-open">Recipe ›</span>
      </div>
    </template>

    <!-- The back: how to make it. -->
    <template v-else>
      <div ref="how" class="idea-how">
        <h2 class="idea-how-name">{{ idea.name }}</h2>
        <div class="idea-how-side" data-fit>
          <ul class="idea-ingredients">
            <li v-for="(item, index) in fromHouse" :key="index" :class="{ gone: item.gone }">
              <span class="idea-amount">{{ item.amount }}</span>
              <span class="idea-ingredient">{{ item.name }}</span>
            </li>
          </ul>
          <!-- Salt, spices, water: assumed, so said once and quietly. -->
          <p v-if="fromRack.length" class="idea-rack">
            <span class="idea-rack-label">And</span>{{ fromRack.join(', ') }}
          </p>
        </div>
        <ol class="idea-steps" data-fit>
          <li v-for="(step, index) in idea.steps" :key="index">
            <span class="idea-step-number">{{ index + 1 }}</span>
            <span class="idea-step-text">{{ step }}</span>
          </li>
        </ol>
      </div>
    </template>
  </div>
</template>

<script>
import { formatIdeaDay, formatSoon, ideaIngredients, ideaUses, swatchFor } from '@/store/fridge/idea'

// How many foods the front names before it says "and 4 more". The front is
// for deciding whether it sounds good, not for checking the cupboard.
const USES_SHOWN = 6

// The recipe has to fit the screen it is on: a cook with oily hands does
// not scroll a wall. The type starts at full size and steps down until both
// columns fit; below this it stops and the columns scroll after all.
const SMALLEST_HOW = 0.6

export default {
  name: 'IdeaPoster',
  props: {
    idea: { type: Object, required: true },
    day: { type: String, required: true },
    // False when this is yesterday's, shown while today's is on its way.
    today: { type: Boolean, default: true },
    // ALL the timers, pantry included: the idea cooks from the whole house.
    timers: { type: Array, default: () => [] },
    now: { type: Number, default: () => Date.now() }
  },
  // 'how': the recipe was opened (true) or put away (false).
  emits: ['how'],
  data () {
    return { showHow: false }
  },
  computed: {
    swatch () {
      return swatchFor(this.day)
    },
    label () {
      return this.today ? "Today's idea" : "Yesterday's idea"
    },
    dateLabel () {
      return formatIdeaDay(this.day)
    },
    // The name sets its own size: a four-word dish can shout, a ten-word one
    // has to fit.
    nameSize () {
      const length = (this.idea.name || '').length
      if (length <= 22) return 'short'
      if (length <= 40) return 'medium'
      return 'long'
    },
    uses () {
      return ideaUses(this.idea, this.timers, new Date(this.now))
    },
    usesShown () {
      return this.uses.slice(0, USES_SHOWN)
    },
    usesHidden () {
      return Math.max(0, this.uses.length - USES_SHOWN)
    },
    ingredients () {
      return ideaIngredients(this.idea, this.timers, new Date(this.now))
    },
    fromHouse () {
      return this.ingredients.filter((item) => item.from === 'house')
    },
    fromRack () {
      return this.ingredients.filter((item) => item.from !== 'house').map((item) => item.name)
    }
  },
  watch: {
    // A new day's idea arrives face up, whatever yesterday's was left showing.
    day () {
      this.showHow = false
    },
    // The wall gives the recipe the whole screen (IdeaWall puts the eat-soon
    // line away), so it is fitted once now and again when that has happened.
    showHow (shown) {
      this.$emit('how', shown)
      if (!shown) return
      this.$nextTick(() => {
        this.fitHow()
        requestAnimationFrame(this.fitHow)
      })
    }
  },
  mounted () {
    window.addEventListener('resize', this.fitHow)
  },
  beforeUnmount () {
    window.removeEventListener('resize', this.fitHow)
  },
  methods: {
    formatSoon,
    // "avocado" in the recipe, "Avocado" on the poster.
    sayName (name) {
      const text = String(name || '').trim()
      return text.charAt(0).toUpperCase() + text.slice(1)
    },
    toggle () {
      this.showHow = !this.showHow
    },
    fitHow () {
      const how = this.$refs.how
      if (!how) return
      const columns = [...how.querySelectorAll('[data-fit]')]
      const fits = () => columns.every((el) => el.scrollHeight <= el.clientHeight + 1)
      let scale = 1
      how.style.setProperty('--how-scale', scale)
      while (!fits() && scale > SMALLEST_HOW) {
        scale = Math.round((scale - 0.04) * 100) / 100
        how.style.setProperty('--how-scale', scale)
      }
    }
  }
}
</script>

<style lang="scss" scoped>
/* The wall's own type (Roboto Serif, IBM Plex Mono) on its own black. Sizes
 * are in vw and vh together so the poster fills a 1280x800 tablet and still
 * fits a 960x600 one. No motion anywhere: Carrie asked for quiet. */
.idea-poster {
  --swatch: #ffd60a;

  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: min(3.2vw, 5vh) max(60px, min(4vw, 6vh)) min(2.4vw, 3.6vh);
  color: #fff;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;

  &:focus {
    outline: none;
  }
}

.idea-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: "IBM Plex Mono", monospace;
  font-size: clamp(0.85rem, min(1.5vw, 2.4vh), 1.25rem);
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.idea-label {
  display: inline-flex;
  align-items: center;
  gap: 0.8em;
}

.idea-dot {
  width: 1.05em;
  height: 1.05em;
  background: var(--swatch);
}

.idea-date {
  opacity: 0.55;
}

.idea-middle {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.idea-name {
  font-family: "Roboto Serif", serif;
  font-weight: 500;
  line-height: 1.02;
  letter-spacing: -0.02em;
  text-wrap: balance;
  max-width: 16em;

  &.short {
    font-size: clamp(3rem, min(9.6vw, 16vh), 9.5rem);
  }

  &.medium {
    font-size: clamp(2.6rem, min(7.4vw, 12.5vh), 7.5rem);
  }

  &.long {
    font-size: clamp(2.2rem, min(5.8vw, 10vh), 6rem);
  }
}

.idea-line {
  margin-top: min(2.2vw, 3.4vh);
  max-width: 34em;
  font-size: clamp(1.1rem, min(2.1vw, 3.4vh), 1.9rem);
  font-weight: 300;
  line-height: 1.35;
  opacity: 0.72;
  text-wrap: pretty;
}

.idea-foot {
  display: flex;
  align-items: center;
  gap: min(2.4vw, 3.6vh);
}

.idea-minutes {
  flex: none;
  padding: 0.5em 0.8em 0.45em;
  background: var(--swatch);
  color: #000;
  font-family: "IBM Plex Mono", monospace;
  font-size: clamp(1.1rem, min(2.2vw, 3.6vh), 2rem);
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.idea-uses {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3em 1.3em;
  font-size: clamp(0.95rem, min(1.7vw, 2.8vh), 1.5rem);
  line-height: 1.3;
}

.idea-open {
  flex: none;
  margin-left: auto;
  align-self: flex-end;
  font-family: "IBM Plex Mono", monospace;
  font-size: clamp(0.75rem, min(1.2vw, 2vh), 1rem);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  white-space: nowrap;
  opacity: 0.5;
}

.idea-uses-label {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.72em;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.5;
}

.idea-use {
  opacity: 0.85;

  /* Going off soon: the one place the poster points at something. */
  &.soon {
    opacity: 1;
    box-shadow: inset 0 -0.14em 0 var(--swatch);
  }

  /* Eaten since this was written. */
  &.gone {
    opacity: 0.4;
    text-decoration: line-through;
  }

  &.more {
    opacity: 0.5;
  }
}

.idea-use-left {
  margin-left: 0.5em;
  color: var(--swatch);
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.72em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* --- The back --- */

/* --how-scale is set by fitHow(): 1 when the recipe fits at full size, less
 * when it is a long one. */
.idea-how {
  --how-scale: 1;

  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 8fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: min(1.8vw, 2.8vh) min(4vw, 6vh);
  padding-top: min(2.4vw, 3.6vh);
  cursor: default;
}

.idea-how-name {
  grid-column: 1 / -1;
  font-family: "Roboto Serif", serif;
  font-size: clamp(1.4rem, min(2.7vw, 4.4vh), 2.5rem);
  font-weight: 500;
  line-height: 1.1;
  letter-spacing: -0.01em;
}

.idea-how-side,
.idea-steps {
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
}

.idea-ingredients {
  list-style: none;
  font-size: calc(clamp(0.95rem, min(1.55vw, 2.5vh), 1.35rem) * var(--how-scale));
  line-height: 1.28;

  li {
    display: grid;
    grid-template-columns: minmax(0, 11fr) minmax(0, 9fr);
    gap: 1em;
    align-items: baseline;
    padding: 0.34em 0;
    border-top: 1px solid rgba(255, 255, 255, 0.14);
  }

  .gone .idea-ingredient {
    text-decoration: line-through;
    opacity: 0.5;
  }
}

.idea-amount {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.8em;
  opacity: 0.7;
}

.idea-rack {
  padding-top: 0.6em;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  font-size: calc(clamp(0.9rem, min(1.4vw, 2.3vh), 1.2rem) * var(--how-scale));
  line-height: 1.35;
  opacity: 0.6;
}

.idea-rack-label {
  margin-right: 0.8em;
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.78em;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.idea-steps {
  list-style: none;
  font-size: calc(clamp(1.05rem, min(1.75vw, 2.9vh), 1.55rem) * var(--how-scale));
  font-weight: 300;
  line-height: 1.36;

  li {
    display: grid;
    grid-template-columns: 1.6em 1fr;
    gap: 0.5em;
    padding-bottom: 0.7em;
  }
}

.idea-step-number {
  color: var(--swatch);
  font-family: "IBM Plex Mono", monospace;
  font-weight: 600;
}

.idea-step-text {
  text-wrap: pretty;
}

/* --- Upright ---
 * The kitchen tablet hangs in PORTRAIT (Matt, 2026-11-09), so this is the
 * layout that is actually looked at; the wide one above is for a desk. Tall
 * and narrow: the name takes as many lines as it likes, what it uses sits
 * under the minutes instead of beside them, and the recipe is one column,
 * ingredients two-up above the steps. Sized from the width, capped by the
 * height so a squat window still fits. */
@media (orientation: portrait) {
  .idea-poster {
    padding: min(6vw, 4vh) max(60px, 7vw) min(4vw, 2.6vh);
  }

  .idea-top {
    font-size: clamp(0.85rem, min(2.5vw, 1.7vh), 1.5rem);
  }

  .idea-name {
    max-width: none;

    &.short {
      font-size: clamp(3rem, min(17vw, 11vh), 12rem);
    }

    &.medium {
      font-size: clamp(2.6rem, min(13.5vw, 8.6vh), 10rem);
    }

    &.long {
      font-size: clamp(2.2rem, min(11.5vw, 7.2vh), 8.5rem);
    }
  }

  .idea-line {
    margin-top: min(5vw, 3.2vh);
    font-size: clamp(1.2rem, min(3.9vw, 2.5vh), 2.4rem);
  }

  .idea-foot {
    flex-wrap: wrap;
    align-items: center;
    gap: min(4vw, 2.6vh);
  }

  .idea-minutes {
    font-size: clamp(1.2rem, min(4.2vw, 2.7vh), 2.6rem);
  }

  .idea-open {
    align-self: center;
    font-size: clamp(0.8rem, min(2.3vw, 1.5vh), 1.3rem);
  }

  .idea-uses {
    order: 3;
    flex-basis: 100%;
    font-size: clamp(1.1rem, min(3.4vw, 2.2vh), 2.1rem);
    line-height: 1.4;
  }

  .idea-how {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: min(3.6vw, 2.3vh);
    padding-top: min(5vw, 3.2vh);
  }

  .idea-how-name {
    font-size: clamp(1.6rem, min(5.6vw, 3.6vh), 3.6rem);
    text-wrap: balance;
  }

  .idea-how-side {
    overflow: visible;
  }

  .idea-ingredients {
    columns: 2;
    column-gap: min(5vw, 3.2vh);
    font-size: calc(clamp(1rem, min(2.9vw, 1.85vh), 1.8rem) * var(--how-scale));

    /* The food, then how much of it underneath: two-up there is no room
     * for them side by side. */
    li {
      display: flex;
      flex-direction: column-reverse;
      gap: 0.1em;
      padding: 0.4em 0 0.45em;
      break-inside: avoid;
    }
  }

  .idea-rack {
    font-size: calc(clamp(0.95rem, min(2.6vw, 1.65vh), 1.6rem) * var(--how-scale));
  }

  .idea-steps {
    font-size: calc(clamp(1.1rem, min(3.3vw, 2.1vh), 2.1rem) * var(--how-scale));
  }
}
</style>
