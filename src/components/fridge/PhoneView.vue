<template>
  <div class="phone-view">
    <header class="phone-header">
      <h1>Fridge</h1>
      <p class="phone-sub">Groceries, a receipt, or the fridge.</p>
    </header>

    <button class="scan-cta" @click="$emit('scan')">
      <span class="scan-icon">📷</span>
      <span class="scan-label">Scan groceries</span>
    </button>

    <button class="manual-cta" @click="$emit('add')">
      Add one by hand
    </button>

    <button class="manual-cta" @click="$emit('history')">
      What's changed
    </button>

    <p v-if="justAdded" class="just-added">
      {{ justAdded }} — it's on the kitchen screen now.
    </p>

    <!-- What's on hand.
         Perishable's phone deliberately showed no timers: the wall was three
         steps away and doing that job. Inside meal-hat the phone is also where
         the shopping list gets built, and "do we still have spinach?" is the
         question the whole merge exists to answer — in the aisle, away from
         the wall. So it earns its place here, but as a REFERENCE and not the
         point: soonest-expiring first, collapsed, camera still the hero. -->
    <button
      v-if="onHand.length"
      class="on-hand-toggle"
      @click="showOnHand = !showOnHand"
    >{{ showOnHand ? 'Hide' : "What's in the fridge" }} ({{ onHand.length }})</button>

    <ul v-if="showOnHand && onHand.length" class="on-hand">
      <li v-for="item in onHand" :key="item.id" :class="['on-hand-row', item.status]">
        <span class="on-hand-name">{{ item.title }}</span>
        <span class="on-hand-left">{{ item.label }}</span>
      </li>
    </ul>
  </div>
</template>

<script>
import { computeTimeLeft, timerStatus } from '@/store/fridge/timers'

// The phone. A capture surface first — see utils/fridge/viewMode.js — with a
// collapsed on-hand list underneath for the grocery store.
export default {
  name: 'PhoneView',
  props: {
    justAdded: { type: String, default: '' }
  },
  emits: ['scan', 'add', 'history'],
  data () {
    return {
      // Collapsed by default. The camera is why this screen exists; a list
      // opened every time would bury it.
      showOnHand: false
    }
  },
  computed: {
    onHand () {
      // Already sorted soonest-expiring first by the allTimers getter.
      return this.$store.getters['fridge/allTimers'].map((timer) => {
        const left = computeTimeLeft(timer.expiryDate, new Date())
        return {
          id: timer.id,
          title: timer.title,
          status: timerStatus(left),
          // Whole days only. Seconds ticking down matter on a wall you glance
          // at; in an aisle they are noise, and re-rendering them would keep
          // the phone's screen busy for nothing.
          label: left.expired
            ? 'expired'
            : left.days > 0
              ? `${left.days}d`
              : `${left.hours}h`
        }
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.phone-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding: 1.5rem;
  text-align: center;
}

.phone-header {
  margin-bottom: 0.5rem;

  h1 {
    font-size: 2.25rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .phone-sub {
    margin-top: 0.4rem;
    color: rgba(255, 255, 255, 0.55);
    font-size: 1rem;
  }
}

.scan-cta {
  width: 100%;
  max-width: 340px;
  // Big enough to hit one-handed while holding a shopping bag.
  padding: 2.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  background: rgba(72, 187, 120, 0.12);
  border: 2px solid rgba(72, 187, 120, 0.55);
  border-radius: 20px;
  color: #fff;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.2s ease;

  &:active {
    transform: scale(0.98);
    background: rgba(72, 187, 120, 0.2);
  }

  .scan-icon {
    font-size: 3rem;
    line-height: 1;
  }

  .scan-label {
    font-size: 1.4rem;
    font-weight: 600;
  }
}

.manual-cta {
  width: 100%;
  max-width: 340px;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.85);
  font-family: inherit;
  font-size: 1rem;
  cursor: pointer;

  &:active {
    background: rgba(255, 255, 255, 0.15);
  }
}

.just-added {
  color: #4CAF50;
  font-size: 1rem;
  max-width: 340px;
}

.on-hand-toggle {
  width: 100%;
  max-width: 340px;
  padding: 0.75rem;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-family: inherit;
  font-size: 0.95rem;
  cursor: pointer;
  text-decoration: underline;
}

.on-hand {
  width: 100%;
  max-width: 340px;
  list-style: none;
  text-align: left;

  .on-hand-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.55rem 0.25rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 1rem;
  }

  .on-hand-name {
    color: rgba(255, 255, 255, 0.9);
  }

  // The same three-state colouring the wall cards use, so a glance here and a
  // glance there mean the same thing.
  .on-hand-left {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.45);
    white-space: nowrap;
  }

  .caution .on-hand-left {
    color: #f6ad55;
  }

  .warning .on-hand-left,
  .expired .on-hand-left {
    color: #f56565;
  }
}
</style>
