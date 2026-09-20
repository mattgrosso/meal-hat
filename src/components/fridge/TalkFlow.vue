<template>
  <div class="modal-overlay" @click.self="tryClose">
    <div class="modal-content talk-content">
      <div class="modal-header">
        <h2>{{ title }}</h2>
        <button class="close-btn" @click="tryClose">×</button>
      </div>

      <!-- Say what's in the house -->
      <div v-if="stage === 'talk'" class="talk-stage">
        <p class="talk-hint">
          Open the fridge, the freezer and the cupboards and say what you see.
          Ramble — it's meant to be messy. Say when something's nearly gone,
          say when you're out of something, and take as long as you like.
        </p>

        <p class="talk-mic">
          Tap the 🎤 on your keyboard and talk.
        </p>

        <textarea
          ref="box"
          v-model="transcript"
          class="talk-box"
          rows="12"
          :placeholder="placeholder"
          @input="onType"
        ></textarea>

        <div class="talk-meta">
          <span>{{ wordCount }} words</span>
          <span v-if="savedAt" class="talk-saved">saved</span>
        </div>

        <!-- A few minutes of talking is a lot to lose to a backgrounded tab. -->
        <p v-if="restored" class="talk-restored">
          Picked up where you left off — {{ restoredAgo }}.
          <button class="link-btn" @click="discardDraft">Start over</button>
        </p>

        <button class="talk-btn" :disabled="!canSend" @click="send">
          Work out what we have
        </button>
        <p v-if="errorMessage" class="talk-error">{{ errorMessage }}</p>
      </div>

      <!-- Reading it -->
      <div v-else-if="stage === 'reading'" class="reading-stage">
        <div class="talk-spinner"></div>
        <p class="reading-text">Working through what you said…</p>
        <p class="reading-sub">{{ elapsedLabel }}</p>
      </div>

      <!-- What it made of it -->
      <div v-else-if="stage === 'review'" class="review-stage">
        <!-- What it got RIGHT goes first, always. Being shown that it heard
             twenty things correctly is what makes the removals below
             trustworthy — Matt's own report on the photo flow said exactly
             this ("so I can feel like it did see things"). -->
        <template v-if="review.confirmed.length">
          <h3 class="pile-head">Still here ({{ review.confirmed.length }})</h3>
          <ul class="seen-list">
            <li v-for="row in review.confirmed" :key="row.id" class="seen-row">
              <span class="seen-tick">✓</span>
              <span class="seen-title">{{ row.title }}</span>
              <span class="seen-left">{{ leftLabel(row) }}</span>
            </li>
          </ul>
        </template>

        <template v-if="review.newItems.length">
          <h3 class="pile-head">New — adding these ({{ review.newItems.length }})</h3>
          <div
            v-for="(item, index) in review.newItems"
            :key="'new' + index"
            class="review-row"
            :class="{ excluded: !item.included }"
          >
            <div class="review-top">
              <input
                :id="'inc' + index"
                v-model="item.included"
                type="checkbox"
                class="review-check"
              >
              <input
                v-model="item.name"
                class="review-name"
                @change="rename(item)"
              >
            </div>

            <!-- His own words. The ONLY way a misreading is catchable: a row
                 saying "Pepper" is fine until you see it came from "half a
                 block of pepper jack". -->
            <p v-if="item.heard" class="review-heard">“{{ item.heard }}”</p>

            <p v-if="item.readAs" class="review-renamed">
              read as “{{ item.readAs }}” — filed under your {{ item.name }}
            </p>

            <!-- NO DURATION FIELD. Matt, 2026-09-20: "Don't confirm with me
                 how long something should be... just make your best guess."
                 Forty of these in one sitting is data entry, not review. The
                 guess is stated so it can be checked, and it is corrected on
                 the kitchen screen — which is also how the app learns. -->
            <div class="review-bottom">
              <span v-if="!item.shelfStable" class="days-chip">{{ formatDays(item.days) }}</span>
              <span v-if="!item.shelfStable" class="days-source">
                {{ item.fromTemplate ? 'what yours usually lasts' : 'best guess' }}
              </span>
              <label v-if="item.quantity > 1" class="qty-label">
                ×{{ item.quantity }}
              </label>
              <span v-if="item.shelfStable" class="pantry-chip">pantry — tracked, no countdown</span>
            </div>
          </div>
        </template>

        <!-- The pile that is CHECKED, and the reason this screen exists at all.
             Matt's call: "we should assume that if I don't list it, then it
             isn't there." Every other screen in this app arrives unchecked. -->
        <template v-if="review.notHeard.length">
          <h3 class="pile-head danger">
            Didn't hear these — removing ({{ removingCount }})
          </h3>
          <p class="pile-note">
            You said you'd list everything, so these go. Untick anything you
            just forgot to mention.
          </p>
          <div v-for="row in review.notHeard" :key="row.id" class="gone-row">
            <input
              :id="'gone' + row.id"
              v-model="row.remove"
              type="checkbox"
              class="review-check"
            >
            <label :for="'gone' + row.id" class="gone-body">
              <span class="gone-title">{{ row.title }}</span>
              <span class="gone-meta">
                <template v-if="row.saidOutOf">you said you're out of it</template>
                <template v-else>
                  {{ leftLabel(row) }}<template v-if="row.addedDaysAgo !== null">
                    · added {{ row.addedDaysAgo }}d ago</template>
                </template>
              </span>
            </label>
          </div>
        </template>

        <template v-if="review.unclear.length">
          <h3 class="pile-head">Couldn't place these</h3>
          <ul class="unclear-list">
            <li v-for="(row, index) in review.unclear" :key="'u' + index">
              “{{ row.heard }}” — {{ row.why }}
            </li>
          </ul>
        </template>

        <p v-if="nothingAtAll" class="talk-error">
          Nothing in that sounded like food. Have a look at what you said and
          try again.
        </p>

        <div class="review-actions">
          <button class="cancel-btn" @click="backToTalk">Back</button>
          <button class="confirm-btn" :disabled="!ready || saving" @click="confirm">
            {{ saving ? 'Saving…' : confirmLabel }}
          </button>
        </div>
      </div>

      <!-- Done -->
      <div v-else-if="stage === 'done'" class="done-stage">
        <p class="done-text">{{ doneMessage }}</p>
        <button class="talk-btn" @click="$emit('close')">Done</button>
      </div>
    </div>
  </div>
</template>

<script>
// The spoken inventory: a few minutes of "what's in the fridge", turned into
// what the house holds.
//
// WHY TYPING AND NOT RECORDING. The obvious build is a record button, audio to
// a transcription service, text back. Matt's call was the other one: the mic
// on the iOS keyboard is Apple's own dictation, it is more accurate on food
// names than anything we would send audio to, it costs nothing per use, and it
// needs no new infrastructure. The cost is that iOS stops dictating after a
// pause, so a long ramble means tapping the mic again — which is why the text
// is a real editable box he can also type into, and why the draft is saved on
// every keystroke.
//
// The endpoint, the auth and the job pipeline are the scan flow's, unchanged.

import { readTranscript, ScanError } from '@/utils/fridge/scan'
import { ensureSession } from '@/firebase'
import { buildTalkReview, talkReviewReady, talkPayload } from '@/store/fridge/talkReview'
import { guessDays } from '@/store/fridge/shelfLife'
import { findTemplate } from '@/store/fridge/scanReview'
import { computeTimeLeft, formatDaySpan } from '@/store/fridge/timers'
import { saveDraft, readDraft, clearDraft } from '@/utils/fridge/talkDraft'
import { knownFoodNames } from '@/store/fridge/vocabulary'

export default {
  name: 'TalkFlow',
  props: {
    householdKey: { type: String, required: true },
    // EVERY timer, pantry included — this screen decides what stays and what
    // goes, so it cannot be handed the wall's filtered view. A pantry item
    // missing from this list would be silently exempt from removal and would
    // then never leave the fridge record at all.
    timers: { type: Array, default: () => [] }
  },
  emits: ['close', 'applied'],
  data () {
    return {
      stage: 'talk',
      transcript: '',
      restored: false,
      restoredAt: null,
      savedAt: null,
      errorMessage: '',
      review: { confirmed: [], newItems: [], notHeard: [], unclear: [] },
      saving: false,
      applied: null,
      elapsed: 0,
      ticker: null,
      placeholder: 'Okay, fridge — there\'s a half gallon of milk, couple of eggs left maybe four, the cheddar\'s open but fine, lettuce is starting to go…'
    }
  },
  computed: {
    title () {
      if (this.stage === 'review') return 'What I heard'
      if (this.stage === 'done') return 'Done'
      return 'Say what\'s in the house'
    },
    wordCount () {
      const trimmed = this.transcript.trim()
      return trimmed ? trimmed.split(/\s+/).length : 0
    },
    canSend () {
      return this.wordCount >= 3
    },
    restoredAgo () {
      if (!this.restoredAt) return ''
      const mins = Math.round((Date.now() - this.restoredAt) / 60000)
      if (mins < 1) return 'a moment ago'
      if (mins < 60) return `${mins} min ago`
      const hours = Math.round(mins / 60)
      return `${hours}h ago`
    },
    elapsedLabel () {
      return this.elapsed < 10
        ? 'this takes a moment'
        : `${this.elapsed}s — still going`
    },
    removingCount () {
      return this.review.notHeard.filter((row) => row.remove).length
    },
    addingCount () {
      return this.review.newItems.filter((item) => item.included).length
    },
    nothingAtAll () {
      return !this.review.confirmed.length &&
        !this.review.newItems.length &&
        !this.review.notHeard.length
    },
    ready () {
      return talkReviewReady(this.review.newItems) && !this.nothingAtAll
    },
    confirmLabel () {
      const parts = []
      if (this.addingCount) parts.push(`add ${this.addingCount}`)
      if (this.removingCount) parts.push(`remove ${this.removingCount}`)
      // The button says what it is about to do. On the one screen in this app
      // that removes things in bulk, a bare "Confirm" is not good enough.
      return parts.length ? parts.join(', ') : 'Nothing to change'
    },
    doneMessage () {
      if (!this.applied) return 'All set.'
      const { added, removed, failed } = this.applied
      const parts = []
      if (added) parts.push(`${added} added`)
      if (removed) parts.push(`${removed} removed`)
      const done = parts.length
        ? `${parts.join(', ')}. Your shopping list knows about it.`
        : 'Nothing changed.'
      // Say it out loud. A partial apply that reports itself as a clean one
      // sends him to the shop trusting a list that is wrong.
      return failed
        ? `${done} ${failed} didn't save — check the fridge before you shop.`
        : done
    },
    templates () {
      return this.$store.getters['fridge/templates']
    },

    // Both vocabularies, not just the fridge's — see vocabulary.js. A signed-in
    // phone has the catalog; the wall tablet cannot read it at all and falls
    // back to templates alone, which is exactly what it had before.
    knownFoods () {
      return knownFoodNames({
        templates: this.templates,
        catalog: this.$store.state.groceryCatalog || {},
        shoppingList: this.$store.state.shoppingList || {}
      })
    }
  },
  mounted () {
    const draft = readDraft()
    if (draft) {
      this.transcript = draft.text
      this.restored = true
      this.restoredAt = draft.at
    }
    this.$nextTick(() => this.$refs.box?.focus())
  },
  beforeUnmount () {
    if (this.ticker) clearInterval(this.ticker)
  },
  methods: {
    onType () {
      saveDraft(this.transcript)
      this.savedAt = Date.now()
      this.restored = false
    },

    discardDraft () {
      this.transcript = ''
      this.restored = false
      clearDraft()
      this.$refs.box?.focus()
    },

    // Closing mid-sentence must not throw the text away — it is the only copy
    // of a walk around the kitchen, and the draft outlives the sheet.
    tryClose () {
      if (this.stage === 'reading' || this.saving) return
      this.$emit('close')
    },

    backToTalk () {
      this.stage = 'talk'
      this.$nextTick(() => this.$refs.box?.focus())
    },

    async send () {
      this.errorMessage = ''
      this.stage = 'reading'
      this.elapsed = 0
      this.ticker = setInterval(() => { this.elapsed += 1 }, 1000)

      try {
        // Fetched per send, never held: a token lasts an hour and this screen
        // can sit open far longer than that. ensureSession() rather than
        // currentUser, because the wall tablet's anonymous session may not have
        // been established yet and a missing token reads as a rejected key.
        const user = await ensureSession()
        const idToken = user ? await user.getIdToken() : ''
        const result = await readTranscript(this.transcript, {
          householdKey: this.householdKey,
          idToken,
          // His own vocabulary, so the answer comes back in it — and in the
          // names the SHOPPING LIST joins on, not only the fridge's.
          knownFoods: this.knownFoods
        })

        this.review = buildTalkReview(result, this.timers, this.templates, new Date())
        this.stage = 'review'
      } catch (error) {
        this.errorMessage = error instanceof ScanError
          ? error.message
          : 'Something went wrong working that out.'
        this.stage = 'talk'
      } finally {
        clearInterval(this.ticker)
        this.ticker = null
      }
    },

    // A row renamed by hand is re-matched, because the shelf life came with
    // the NAME and not with the sentence. Typing "Mozzarella" over a row that
    // arrived as cheddar must not leave cheddar's 74 days sitting there.
    rename (item) {
      const template = findTemplate(item.name, this.templates)
      item.name = template ? template.title : String(item.name || '').trim()
      // Re-guess for the food it is NOW — the same question the row was born
      // asking. Keeping the old food's number is the bug this guards.
      item.days = guessDays({ estimate: item.estimateDays, template }) || item.days
      item.fromTemplate = Boolean(template)
      item.readAs = ''
    },

    formatDays (days) {
      return formatDaySpan(days)
    },

    leftLabel (row) {
      const left = row.timeLeft || computeTimeLeft(row.expiryDate, new Date())
      if (left.expired) return 'expired'
      return left.days > 0 ? `${left.days}d left` : `${left.hours}h left`
    },

    async confirm () {
      this.saving = true
      try {
        // The plan shown IS the plan applied — one pure function builds both,
        // so what he agreed to and what hits the database cannot drift.
        const payload = talkPayload(this.review, new Date())
        const applied = await this.$store.dispatch('fridge/applyTalk', { payload })
        this.applied = applied
        clearDraft()
        this.$emit('applied', applied)
        this.stage = 'done'
      } catch (error) {
        console.error('Failed to apply the talk-through:', error)
        this.errorMessage = 'Could not save all of that. Have a look at the fridge.'
      } finally {
        this.saving = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
/* Scoped, and it must stay that way — the fridge's styles live in a lazy
 * chunk and anything unscoped here would leak into every meal-hat screen.
 *
 * WHICH MEANS THE SHELL HAS TO BE REPEATED HERE. The class names are shared
 * with the scan sheet, but ScanFlow's rules are scoped to ScanFlow and do not
 * reach this component — so borrowing the markup borrowed nothing, and the
 * sheet came up as transparent, unpositioned and half off-screen, because
 * BOOTSTRAP also defines `.modal-content` and `.modal-header` and its rules
 * were the only ones landing. Only caught by opening it in a browser.
 *
 * Fridge.vue's phone rules DO reach both (they match a descendant), so the
 * bottom-sheet treatment below 900px still comes for free. */

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
    color: #fff;
  }

  .close-btn {
    background: none;
    border: 0;
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

.talk-stage {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.talk-hint {
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.45;
}

.talk-mic {
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.9rem;
  margin: 0;
}

.talk-box {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  color: #fff;
  padding: 0.85rem;
  font-family: inherit;
  /* 16px or more, or iOS zooms the whole page on focus and the sheet jumps. */
  font-size: 1rem;
  line-height: 1.5;
  resize: vertical;

  &::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  &:focus {
    outline: none;
    border-color: rgba(76, 175, 80, 0.7);
  }
}

.talk-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.4);
}

.talk-saved {
  color: rgba(76, 175, 80, 0.8);
}

.talk-restored {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.6);
  margin: 0;
}

.link-btn {
  background: none;
  border: 0;
  color: rgba(76, 175, 80, 0.9);
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
  font: inherit;
}

.talk-btn {
  padding: 1.1rem;
  background: #4caf50;
  color: #fff;
  border: 0;
  border-radius: 8px;
  font-size: 1.05rem;
  font-weight: 500;
  cursor: pointer;

  &:disabled {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.4);
    cursor: default;
  }
}

.talk-error {
  color: #ff8a80;
  margin: 0;
}

.reading-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 0;
  text-align: center;
}

.talk-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.15);
  border-top-color: #4caf50;
  border-radius: 50%;
  animation: talk-spin 1s linear infinite;
}

@keyframes talk-spin {
  to {
    transform: rotate(360deg);
  }
}

.reading-text {
  color: #fff;
  margin: 0;
}

.reading-sub {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.85rem;
  margin: 0;
}

.pile-head {
  font-size: 1rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  margin: 1.25rem 0 0.5rem;

  &.danger {
    color: #ffab91;
  }
}

.pile-note {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.5);
  margin: 0 0 0.75rem;
  line-height: 1.4;
}

.seen-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.seen-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.seen-tick {
  color: #4caf50;
}

.seen-title {
  flex: 1;
  color: rgba(255, 255, 255, 0.9);
}

.seen-left {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.45);
}

.review-row {
  padding: 0.75rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);

  &.excluded {
    opacity: 0.45;
  }
}

.review-top {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.review-check {
  width: 22px;
  height: 22px;
  flex: none;
  accent-color: #4caf50;
}

.review-name {
  flex: 1;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #fff;
  padding: 0.45rem 0.6rem;
  font-size: 1rem;
  font-family: inherit;
}

.review-heard {
  margin: 0.4rem 0 0 2.2rem;
  font-size: 0.85rem;
  font-style: italic;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.35;
}

.review-renamed {
  margin: 0.3rem 0 0 2.2rem;
  font-size: 0.8rem;
  color: #ffcc80;
}

.review-bottom {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0.5rem 0 0 2.2rem;
  flex-wrap: wrap;
}

.days-chip {
  padding: 0.3rem 0.65rem;
  background: rgba(76, 175, 80, 0.85);
  border-radius: 999px;
  color: #fff;
  font-size: 0.85rem;
}

.days-source {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.45);
}

.qty-label {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.6);
}

.pantry-chip {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
}

.gone-row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.gone-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
}

.gone-title {
  color: rgba(255, 255, 255, 0.9);
}

.gone-meta {
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.45);
}

.unclear-list {
  margin: 0;
  padding-left: 1.1rem;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.85rem;
  line-height: 1.5;
}

.review-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.cancel-btn,
.confirm-btn {
  flex: 1;
  padding: 0.9rem;
  border-radius: 8px;
  font-size: 1rem;
  border: 0;
  cursor: pointer;
}

.cancel-btn {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.confirm-btn {
  background: #4caf50;
  color: #fff;

  &:disabled {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.4);
    cursor: default;
  }
}

.done-stage {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1rem 0;
  text-align: center;
}

.done-text {
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
  line-height: 1.5;
}
</style>
