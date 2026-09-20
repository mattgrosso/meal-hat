<template>
  <div class="phone-view">
    <!-- The house header, same as every other meal-hat screen. Matt,
         2026-09-20: "we should really incorporate all of this into the main
         site design instead of having it feel like it's a separate thing."
         The tap-the-icon-for-home and tap-the-stamp-to-reload behaviours come
         with it, which is also the answer to "there's no easy way to get back".

         Signed-in only, and that condition is load-bearing: this same
         component is what the WALL TABLET renders if it ever reports under
         900px, and the tablet is a member of no hat — the header would show an
         empty email and link to a login nobody can complete in a kiosk. -->
    <Header v-if="signedIn" headerText="Fridge" />

    <div class="fridge-body p-3">
      <p class="text-muted fridge-sub">
        Say what's in the house, scan a receipt, or add something by hand.
      </p>

      <!-- The hero. Matt on the camera: "I don't really trust that." A person
           opening the fridge and saying what is in it beats a model squinting
           at a photo of it, and it answers what the camera never could — what
           is behind the milk. -->
      <button class="btn btn-primary w-100 talk-cta" @click="$emit('talk')">
        <span class="talk-icon">🎤</span>
        <span>Talk through the kitchen</span>
      </button>

      <div class="btn-group w-100 mt-2" role="group">
        <!-- Receipts survived the camera's retirement because a receipt is
             printed text, which is the one thing the photo flow was genuinely
             reliable at: it reads lines rather than guessing at food. -->
        <button class="btn btn-secondary" @click="$emit('scan')">Scan a receipt</button>
        <button class="btn btn-tertiary" @click="$emit('add')">Add by hand</button>
      </div>

      <div class="btn-group w-100 mt-2" role="group">
        <button class="btn btn-outline-secondary" @click="$emit('history')">What's changed</button>
        <button
          v-if="canPair"
          class="btn btn-outline-secondary"
          @click="showPair = !showPair"
        >Pair a wall display</button>
      </div>

      <p v-if="justAdded" class="alert alert-success mt-3 mb-0 py-2">
        {{ justAdded }} — it's on the kitchen screen now.
      </p>

      <!-- Hand the wall its key without typing the key on the wall. The tablet
           shows a six-digit code on its not-connected screen; this is where it
           gets typed. Only a member with the hat's pointer can do it. -->
      <form v-if="canPair && showPair" class="pair-form mt-3" @submit.prevent="pair">
        <label class="form-label" for="pair-code">The code on the wall</label>
        <div class="input-group">
          <input
            id="pair-code"
            v-model="pairCode"
            class="form-control"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="482 116"
            :disabled="pairing"
          >
          <button class="btn btn-primary" type="submit" :disabled="!pairCodeValid || pairing">
            {{ pairing ? 'Sending…' : 'Pair' }}
          </button>
        </div>
        <p v-if="pairMessage" class="form-text">{{ pairMessage }}</p>
      </form>

      <!-- What's on hand.
           Perishable's phone deliberately showed no timers: the wall was three
           steps away and doing that job. Inside meal-hat the phone is also
           where the shopping list gets built, and "do we still have spinach?"
           is the question the whole merge exists to answer — in the aisle,
           away from the wall. So it earns its place, but as a REFERENCE and
           not the point: soonest-expiring first, collapsed. -->
      <div v-if="onHand.length" class="on-hand-section mt-4">
        <button type="button" class="on-hand-toggle" @click="showOnHand = !showOnHand">
          <i :class="showOnHand ? 'bi bi-chevron-down' : 'bi bi-chevron-right'"></i>
          What's in the fridge ({{ onHand.length }})
        </button>

        <ul v-if="showOnHand" class="list-group my-2">
          <li
            v-for="item in onHand"
            :key="item.id"
            class="list-group-item d-flex justify-content-between align-items-center"
          >
            <span>
              {{ item.title }}
              <span v-if="item.quantity > 1" class="text-muted">×{{ item.quantity }}</span>
            </span>
            <span class="badge" :class="badgeClass(item.status)">{{ item.label }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script>
import { computeTimeLeft, timerStatus } from '@/store/fridge/timers'
import { normalizePairingCode } from '@/utils/fridge/pairing'
import Header from '@/components/Header.vue'

// The phone. A capture surface first — see utils/fridge/viewMode.js — with a
// collapsed on-hand list underneath for the grocery store.
export default {
  name: 'PhoneView',
  components: { Header },
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
          quantity: timer.quantity,
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
    // The wall's four states in meal-hat's palette. Same information, same
    // ordering, read with the app's colours instead of Perishable's.
    badgeClass (status) {
      if (status === 'expired') return 'bg-danger'
      if (status === 'warning') return 'bg-danger'
      if (status === 'caution') return 'bg-warning text-dark'
      return 'bg-success'
    },

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
/* A meal-hat page, not a Perishable one. Bootstrap does almost all of it —
 * the buttons, the list group, the badges are the app's own — so what is left
 * here is only what Bootstrap has no opinion about. */

.fridge-sub {
  margin-bottom: 1rem;
}

/* The hero gets height the others don't. It is the thing this screen is for,
 * and on a phone held one-handed in a kitchen it wants to be hard to miss. */
.talk-cta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 1.25rem;
  font-size: 1.15rem;
}

.talk-icon {
  font-size: 1.6rem;
  line-height: 1;
}

.on-hand-toggle {
  background: none;
  border: 0;
  padding: 0;
  color: #274C77;
  font-size: 1rem;
  font-family: inherit;
  cursor: pointer;

  i {
    margin-right: 0.25rem;
  }
}
</style>
