<template>
  <!-- Today's idea on the phone: the same idea the wall shows (see
       IdeaPoster.vue and aws-lambda/idea.js), as a meal-hat card. Closed it is
       three lines; open it is the recipe. -->
  <div class="idea-card mt-3" :style="{ '--swatch': swatch }">
    <button type="button" class="idea-card-head" :aria-expanded="open" @click="open = !open">
      <span class="idea-card-label">{{ today ? "Today's idea" : "Yesterday's idea" }}</span>
      <span class="idea-card-name">{{ idea.name }}</span>
      <span v-if="idea.line" class="idea-card-line">{{ idea.line }}</span>
      <span class="idea-card-meta">
        <span v-if="idea.minutes">{{ idea.minutes }} min</span>
        <span v-if="soonest" class="idea-card-soon">uses the {{ soonest }}</span>
        <i :class="open ? 'bi bi-chevron-up' : 'bi bi-chevron-down'"></i>
      </span>
    </button>

    <div v-if="open" class="idea-card-body">
      <ul class="idea-card-ingredients">
        <li
          v-for="(item, index) in ingredients"
          :key="index"
          :class="{ assumed: item.from !== 'house', gone: item.gone }"
        >
          <span class="idea-card-amount">{{ item.amount }}</span>
          <span>{{ item.name }}<span v-if="item.soon && !item.gone" class="idea-card-left">{{ formatSoon(item.daysLeft) }}</span></span>
        </li>
      </ul>
      <ol class="idea-card-steps">
        <li v-for="(step, index) in idea.steps" :key="index">{{ step }}</li>
      </ol>
    </div>
  </div>
</template>

<script>
import { formatSoon, ideaIngredients, ideaUses, swatchFor } from '@/store/fridge/idea'

export default {
  name: 'IdeaCard',
  props: {
    idea: { type: Object, required: true },
    day: { type: String, required: true },
    today: { type: Boolean, default: true },
    timers: { type: Array, default: () => [] }
  },
  data () {
    return { open: false }
  },
  computed: {
    swatch () {
      return swatchFor(this.day)
    },
    ingredients () {
      return ideaIngredients(this.idea, this.timers, new Date())
    },
    // The food it leans on that is going off first, said the way a person
    // would: "uses the spinach".
    soonest () {
      const first = ideaUses(this.idea, this.timers, new Date()).find((item) => item.soon && !item.gone)
      return first ? first.name : ''
    }
  },
  methods: { formatSoon }
}
</script>

<style lang="scss" scoped>
/* A meal-hat card: Mulish, white, the app's own greys. The day's swatch is the
 * bar down its left edge, the same colour the wall is wearing. */
.idea-card {
  --swatch: #ffd60a;

  border: 1px solid #dee2e6;
  border-left: 10px solid var(--swatch);
  border-radius: 6px;
  background: #fff;
}

.idea-card-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  width: 100%;
  padding: 0.75rem 0.9rem;
  background: none;
  border: 0;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.idea-card-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6c757d;
}

.idea-card-name {
  font-size: 1.3rem;
  font-weight: 800;
  line-height: 1.15;
  color: #212529;
}

.idea-card-line {
  font-size: 0.95rem;
  line-height: 1.35;
  color: #495057;
}

.idea-card-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  margin-top: 0.25rem;
  font-size: 0.85rem;
  color: #6c757d;

  i {
    margin-left: auto;
  }
}

.idea-card-soon {
  color: #212529;
}

.idea-card-body {
  padding: 0 0.9rem 0.9rem;
}

.idea-card-ingredients {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  font-size: 0.95rem;

  li {
    display: grid;
    grid-template-columns: 7.5em 1fr;
    gap: 0.6rem;
    padding: 0.35rem 0;
    border-top: 1px solid #e9ecef;
  }

  .assumed {
    color: #868e96;
  }

  .gone {
    text-decoration: line-through;
    color: #adb5bd;
  }
}

.idea-card-amount {
  color: #6c757d;
}

.idea-card-left {
  margin-left: 0.5rem;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #b06a00;
}

.idea-card-steps {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 1rem;
  line-height: 1.45;

  li {
    padding-bottom: 0.6rem;
  }
}
</style>
