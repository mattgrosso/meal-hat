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
        <p class="reading-safe">You can leave the app — it'll finish either way.</p>
        <p class="reading-sub">{{ elapsedLabel }}</p>
      </div>

      <!-- What it did. NOT a confirmation — Matt, 2026-09-20: "I want my
           stream of consciousness read-through to just be interpreted, and
           I'm going to assume you got it right. I don't want any kind of
           checks." So this screen has no decision on it. It is a receipt for
           work already done, and it exists because being told what happened
           is not the same as being asked to approve it. -->
      <div v-else-if="stage === 'done'" class="review-stage">
        <!-- The Done button sits at the TOP. Matt, 2026-09-20: "the done
             button should be at the top so I don't have to scroll through it
             all if I don't want to." The list below is there to be read if he
             wants it, not waded through to get out. Sticky, so it stays
             reachable once he does start scrolling. -->
        <div class="done-bar">
          <p class="done-line">{{ doneMessage }}</p>
          <button class="done-btn" @click="$emit('close')">Done</button>
        </div>

        <template v-if="report.added.length">
          <h3 class="pile-head">Added ({{ report.added.length }})</h3>
          <ul class="seen-list">
            <li v-for="(row, i) in report.added" :key="'a' + i" class="seen-row">
              <span class="seen-tick">+</span>
              <span class="seen-title">
                {{ row.name }}<span v-if="row.quantity > 1"> ×{{ row.quantity }}</span>
              </span>
              <span class="seen-left">{{ row.shelfStable ? 'pantry' : formatDays(row.days) }}</span>
            </li>
          </ul>
        </template>

        <template v-if="report.confirmed.length">
          <h3 class="pile-head">Already had ({{ report.confirmed.length }})</h3>
          <ul class="seen-list">
            <li v-for="row in report.confirmed" :key="row.id" class="seen-row">
              <span class="seen-tick">✓</span>
              <span class="seen-title">{{ row.title }}</span>
              <span class="seen-left">{{ leftLabel(row) }}</span>
            </li>
          </ul>
        </template>

        <template v-if="report.removed.length">
          <h3 class="pile-head danger">Removed ({{ report.removed.length }})</h3>
          <p class="pile-note">
            You didn't mention these, so they're gone. Say them next time and
            they'll come straight back.
          </p>
          <ul class="seen-list">
            <li v-for="row in report.removed" :key="row.id" class="seen-row">
              <span class="seen-tick gone">−</span>
              <span class="seen-title">{{ row.title }}</span>
              <span class="seen-left">{{ row.saidOutOf ? 'you said you\u2019re out' : '' }}</span>
            </li>
          </ul>
        </template>

        <template v-if="report.unclear.length">
          <h3 class="pile-head">Couldn't place these</h3>
          <ul class="unclear-list">
            <li v-for="(row, index) in report.unclear" :key="'u' + index">
              “{{ row.heard }}” — {{ row.why }}
            </li>
          </ul>
        </template>

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

import { submitTranscript, awaitScan, ScanError } from '@/utils/fridge/scan'
import { ensureSession } from '@/firebase'
import { buildTalkReview, talkPayload } from '@/store/fridge/talkReview'
import { computeTimeLeft, formatDaySpan } from '@/store/fridge/timers'
import { saveDraft, readDraft, clearDraft } from '@/utils/fridge/talkDraft'
import { rememberJob, readPendingJob, clearPendingJob } from '@/utils/fridge/pendingJob'
import { requestNotifyPermission, notifyDone } from '@/utils/fridge/notify'
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
      resuming: false,
      transcript: '',
      report: { added: [], confirmed: [], removed: [], unclear: [] },
      restored: false,
      restoredAt: null,
      savedAt: null,
      errorMessage: '',
      applied: null,
      elapsed: 0,
      ticker: null,
      placeholder: 'Okay, fridge — there\'s a half gallon of milk, couple of eggs left maybe four, the cheddar\'s open but fine, lettuce is starting to go…'
    }
  },
  computed: {
    title () {
      if (this.stage === 'done') return 'What I heard'
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
      if (this.resuming) return 'picking up where it left off'
      return this.elapsed < 10
        ? 'this takes a moment'
        : `${this.elapsed}s — still going`
    },
    // A statement of what happened, not a question. Failures are said out
    // loud: a partial apply reported as a clean one sends him to the shop
    // trusting a list that is wrong.
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
    // A read-through that was still being worked on when the app went away.
    // Collecting it is the whole reason leaving is safe: the model has already
    // finished and the answer is sitting in S3, so this usually resolves in
    // one poll. See pendingJob.js.
    const pending = readPendingJob()
    if (pending?.kind === 'talk') {
      this.resume(pending)
      return
    }

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
      if (this.stage === 'reading') return
      this.$emit('close')
    },

    // Pick up a job submitted before the app was closed, and apply it.
    async resume (pending) {
      this.stage = 'reading'
      this.resuming = true
      try {
        const user = await ensureSession()
        const idToken = user ? await user.getIdToken() : ''
        const result = await awaitScan(pending.id, { householdKey: this.householdKey, idToken })
        await this.applyResult(result)
      } catch (error) {
        // A job that has expired or failed is not recoverable, and the draft
        // is still here — so drop the pointer and put him back in the box with
        // his words rather than on an error he can do nothing about.
        clearPendingJob()
        this.errorMessage = error instanceof ScanError
          ? `${error.message} Your words are still here.`
          : 'That read-through did not finish. Your words are still here.'
        const draft = readDraft()
        if (draft) { this.transcript = draft.text; this.restored = true; this.restoredAt = draft.at }
        this.stage = 'talk'
      } finally {
        this.resuming = false
      }
    },

    async send () {
      this.errorMessage = ''
      // Asked here, with the spinner about to appear, rather than on a cold
      // screen — a permission prompt with no context in front of it is the one
      // that gets denied forever.
      requestNotifyPermission()
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
        const auth = { householdKey: this.householdKey, idToken }

        // Submit and REMEMBER, in that order, before waiting on anything. The
        // answer lands in S3 whether or not this page is still alive to
        // collect it — so the id is the receipt, and it is written down before
        // there is any chance of the page going away. See pendingJob.js.
        const jobId = await submitTranscript(this.transcript, { ...auth, knownFoods: this.knownFoods })
        rememberJob({ id: jobId, kind: 'talk' })

        const result = await awaitScan(jobId, auth)

        await this.applyResult(result)
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

    // NO CONFIRMATION STEP. Read it, apply it, say what happened. Matt was
    // explicit twice: "I don't want any kind of checks." Every row is included
    // and every unmentioned timer goes, which is what the review screen
    // defaulted to anyway — it was only ever a place to change one's mind.
    //
    // What makes that safe is not carefulness here, it is the loop: a
    // talk-through rebuilds the whole picture every week, so a wrong removal
    // costs one mention next time. The change log keeps the record either way.
    //
    // Shared by a fresh submit and by a job resumed after the app was closed,
    // so both land in exactly the same place.
    async applyResult (result) {
      const now = new Date()
      const review = buildTalkReview(result, this.timers, this.templates, now)
      const applied = await this.$store.dispatch('fridge/applyTalk', {
        payload: talkPayload(review, now)
      })

      this.applied = applied
      this.report = {
        added: review.newItems,
        confirmed: review.confirmed,
        removed: review.notHeard,
        unclear: review.unclear
      }
      clearDraft()
      clearPendingJob()
      this.$emit('applied', applied)
      this.stage = 'done'
      // Only fires if he is looking elsewhere — see notify.js.
      notifyDone('Fridge updated', this.doneMessage)
    },

    formatDays (days) {
      return formatDaySpan(days)
    },

    leftLabel (row) {
      const left = row.timeLeft || computeTimeLeft(row.expiryDate, new Date())
      if (left.expired) return 'expired'
      return left.days > 0 ? `${left.days}d left` : `${left.hours}h left`
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
    color: var(--fr-text);
  }

  .close-btn {
    background: none;
    border: 0;
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

.talk-stage {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.talk-hint {
  color: var(--fr-muted);
  line-height: 1.45;
}

.talk-mic {
  color: var(--fr-muted);
  font-size: 0.9rem;
  margin: 0;
}

.talk-box {
  width: 100%;
  background: var(--fr-field);
  border: 1px solid var(--fr-line);
  border-radius: 10px;
  color: var(--fr-text);
  padding: 0.85rem;
  font-family: inherit;
  /* 16px or more, or iOS zooms the whole page on focus and the sheet jumps. */
  font-size: 1rem;
  line-height: 1.5;
  resize: vertical;

  &::placeholder {
    color: var(--fr-faint);
  }

  &:focus {
    outline: none;
    border-color: var(--fr-accent);
  }
}

.talk-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: var(--fr-faint);
}

.talk-saved {
  color: var(--fr-accent);
}

.talk-restored {
  font-size: 0.85rem;
  color: var(--fr-muted);
  margin: 0;
}

.link-btn {
  background: none;
  border: 0;
  color: var(--fr-accent);
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
  font: inherit;
}

.talk-btn {
  padding: 1.1rem;
  background: var(--fr-accent);
  color: var(--fr-text);
  border: 0;
  border-radius: 8px;
  font-size: 1.05rem;
  font-weight: 500;
  cursor: pointer;

  &:disabled {
    background: var(--fr-field);
    color: var(--fr-faint);
    /* An outline, or on the phone's white sheet a disabled button is a pale
       word floating in nothing rather than a control waiting to be usable. */
    box-shadow: inset 0 0 0 1px var(--fr-line);
    cursor: default;
  }
}

.talk-error {
  color: var(--fr-danger);
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
  border: 3px solid var(--fr-line);
  border-top-color: var(--fr-accent);
  border-radius: 50%;
  animation: talk-spin 1s linear infinite;
}

@keyframes talk-spin {
  to {
    transform: rotate(360deg);
  }
}

.reading-text {
  color: var(--fr-text);
  margin: 0;
}

.reading-sub {
  color: var(--fr-faint);
  font-size: 0.85rem;
  margin: 0;
}

.done-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  /* The sheet scrolls under this, so it needs its own background or the list
     shows through the gap between rows. */
  background: var(--fr-surface);
  padding: 0 0 0.75rem;
  margin-bottom: 0.25rem;
  border-bottom: 1px solid var(--fr-line);

  .done-line {
    flex: 1;
    color: var(--fr-text);
    font-size: 1rem;
    line-height: 1.4;
    margin: 0;
  }

  .done-btn {
    flex: none;
    padding: 0.7rem 1.4rem;
    background: var(--fr-accent);
    color: var(--fr-text);
    border: 0;
    border-radius: 8px;
    font-size: 1rem;
    cursor: pointer;
  }
}

.pile-head {
  font-size: 1rem;
  font-weight: 600;
  color: var(--fr-text);
  margin: 1.25rem 0 0.5rem;

  &.danger {
    color: var(--fr-danger);
  }
}

.pile-note {
  font-size: 0.85rem;
  color: var(--fr-faint);
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
  border-bottom: 1px solid var(--fr-line);
}

.seen-tick {
  color: var(--fr-accent);
  width: 1rem;
  flex: none;

  &.gone {
    color: var(--fr-danger);
  }
}

.seen-title {
  flex: 1;
  color: var(--fr-text);
}

.seen-left {
  font-size: 0.8rem;
  color: var(--fr-faint);
}

.review-row {
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--fr-line);

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
  accent-color: var(--fr-accent);
}

.review-name {
  flex: 1;
  background: var(--fr-field);
  border: 1px solid var(--fr-line);
  border-radius: 6px;
  color: var(--fr-text);
  padding: 0.45rem 0.6rem;
  font-size: 1rem;
  font-family: inherit;
}

.review-heard {
  margin: 0.4rem 0 0 2.2rem;
  font-size: 0.85rem;
  font-style: italic;
  color: var(--fr-faint);
  line-height: 1.35;
}

.review-renamed {
  margin: 0.3rem 0 0 2.2rem;
  font-size: 0.8rem;
  color: var(--fr-warn);
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
  background: var(--fr-accent);
  border-radius: 999px;
  color: var(--fr-text);
  font-size: 0.85rem;
}

.days-source {
  font-size: 0.75rem;
  color: var(--fr-faint);
}

.qty-label {
  font-size: 0.85rem;
  color: var(--fr-muted);
}

.pantry-chip {
  font-size: 0.72rem;
  color: var(--fr-faint);
  border: 1px solid var(--fr-line);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
}

.gone-row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--fr-line);
}

.gone-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
}

.gone-title {
  color: var(--fr-text);
}

.gone-meta {
  font-size: 0.78rem;
  color: var(--fr-faint);
}

.unclear-list {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--fr-faint);
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
  background: var(--fr-line);
  color: var(--fr-text);
}

.confirm-btn {
  background: var(--fr-accent);
  color: var(--fr-text);

  &:disabled {
    background: var(--fr-field);
    color: var(--fr-faint);
    /* An outline, or on the phone's white sheet a disabled button is a pale
       word floating in nothing rather than a control waiting to be usable. */
    box-shadow: inset 0 0 0 1px var(--fr-line);
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
  color: var(--fr-text);
  margin: 0;
  line-height: 1.5;
}
</style>
