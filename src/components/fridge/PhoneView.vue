<template>
  <div class="phone-view">
    <!-- The way back. Matt, 2026-09-20: "there's no easy way for me to get back
         from the fridge dialog to the main meal-hat site."
         Signed-in only, and that condition is not a detail: this same screen
         is what the WALL TABLET shows if it ever reports under 900px, and the
         tablet is a member of no hat and has nowhere to go back to. It would
         be a link to a login page nobody can complete in a kiosk. -->
    <nav v-if="signedIn" class="phone-nav">
      <button class="nav-back" @click="$router.push('/')">‹ Meal Hat</button>
      <button class="nav-link" @click="$router.push('/shopping-list')">Shopping list</button>
    </nav>

    <header class="phone-header">
      <h1>Fridge</h1>
      <p class="phone-sub">Talk it through, scan a receipt, or add one by hand.</p>
    </header>

    <!-- The hero, since 2026-09-20. Matt on the camera: "I don't really trust
         that." A person opening the fridge and saying what is in it beats a
         model squinting at a photo of it, and it answers the question the
         camera never could — what is BEHIND the milk. -->
    <button class="scan-cta" @click="$emit('talk')">
      <span class="scan-icon">🎤</span>
      <span class="scan-label">Talk through the kitchen</span>
    </button>

    <!-- Receipts survived the camera's retirement because a receipt is printed
         text, which is the one thing the photo flow was genuinely reliable at:
         it reads lines rather than guessing at food. -->
    <button class="manual-cta" @click="$emit('scan')">
      📷 Scan a receipt
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

    <!-- Hand the wall its key without typing the key on the wall. The tablet
         shows a six-digit code on its not-connected screen; this is where it
         gets typed. Only a member with the hat's pointer can do it. -->
    <template v-if="canPair">
      <button v-if="!showPair" class="manual-cta" @click="showPair = true">
        Pair a wall display
      </button>
      <form v-else class="pair-form" @submit.prevent="pair">
        <label class="pair-label" for="pair-code">The code on the wall</label>
        <input
          id="pair-code"
          v-model="pairCode"
          class="pair-input"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="482 116"
          :disabled="pairing"
        >
        <button class="pair-btn" type="submit" :disabled="!pairCodeValid || pairing">
          {{ pairing ? 'Sending…' : 'Pair' }}
        </button>
        <p v-if="pairMessage" class="pair-message">{{ pairMessage }}</p>
      </form>
    </template>

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
import { normalizePairingCode } from '@/utils/fridge/pairing'

// The phone. A capture surface first — see utils/fridge/viewMode.js — with a
// collapsed on-hand list underneath for the grocery store.
export default {
  name: 'PhoneView',
  props: {
    justAdded: { type: String, default: '' }
  },
  emits: ['talk', 'scan', 'add', 'history'],
  data () {
    return {
      // Collapsed by default. The camera is why this screen exists; a list
      // opened every time would bury it.
      showOnHand: false,
      showPair: false,
      pairCode: '',
      pairing: false,
      pairMessage: ''
    }
  },
  computed: {
    canPair () {
      return Boolean(this.$store.state.fridgeKeyForHat)
    },
    signedIn () {
      return Boolean(this.$store.state.userEmail)
    },
    pairCodeValid () {
      return Boolean(normalizePairingCode(this.pairCode))
    },
    onHand () {
      // Already sorted soonest-expiring first, and pantry stores filtered
      // out, by the displayTimers getter.
      return this.$store.getters['fridge/displayTimers'].map((timer) => {
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
  },
  methods: {
    async pair () {
      const code = normalizePairingCode(this.pairCode)
      if (!code) return
      this.pairing = true
      this.pairMessage = ''
      try {
        await this.$store.dispatch('fridge/offerPairing', code)
        this.pairMessage = 'Sent — the wall should switch over in a moment.'
        this.pairCode = ''
      } catch (error) {
        console.error('Pairing failed:', error)
        this.pairMessage = "That didn't go through. Check the code and try again."
      } finally {
        this.pairing = false
      }
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
  // Extra at the bottom: the build stamp and the bug button are fixed in the
  // bottom-left corner and sat on top of the last rows of the on-hand list.
  padding: 1.5rem 1.5rem calc(5rem + env(safe-area-inset-bottom));
  text-align: center;
}

.phone-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;

  .nav-back,
  .nav-link {
    background: none;
    border: 0;
    color: rgba(255, 255, 255, 0.6);
    font-family: inherit;
    font-size: 1rem;
    padding: 0.5rem 0;
    cursor: pointer;
  }

  .nav-back {
    color: rgba(255, 255, 255, 0.85);
  }

  .nav-link {
    margin-left: auto;
    text-decoration: underline;
  }
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

.pair-form {
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: stretch;
}

.pair-label {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.95rem;
}

.pair-input {
  padding: 0.9rem 1rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 12px;
  color: #fff;
  font-family: "IBM Plex Mono", monospace;
  font-size: 1.6rem;
  letter-spacing: 0.15em;
  text-align: center;

  &::placeholder {
    color: rgba(255, 255, 255, 0.3);
    letter-spacing: 0.15em;
  }

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.6);
  }
}

.pair-btn {
  padding: 1rem;
  background: #4CAF50;
  border: none;
  border-radius: 12px;
  color: #fff;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.pair-message {
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.95rem;
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
    padding: 0.6rem 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 1rem;
  }

  .on-hand-name {
    color: rgba(255, 255, 255, 0.9);
  }

  // The same three-state colouring the wall cards use, so a glance here and a
  // glance there mean the same thing.
  .on-hand-left {
    font-family: "IBM Plex Mono", monospace;
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
