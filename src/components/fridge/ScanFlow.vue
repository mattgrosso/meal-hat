<template>
  <div class="modal-overlay" @click.self="tryClose">
    <div class="modal-content scan-content">
      <div class="modal-header">
        <h2>{{ title }}</h2>
        <button class="close-btn" @click="tryClose">×</button>
      </div>

      <!-- Pick photos -->
      <div v-if="stage === 'pick'" class="pick-stage">
        <!-- RECEIPTS ONLY since 2026-09-20. Photographing the food itself,
             and photographing the fridge to work out what had been eaten, are
             both retired: Matt did not trust either ("I don't really trust
             that"), and talking through the kitchen replaced them. A receipt
             is different in kind — it is printed text, which is the one thing
             this flow was genuinely reliable at, so it stays. -->
        <p class="pick-hint">
          Photograph the receipt and the shopping goes on the timers, counted
          from the day you actually shopped. A long receipt reads better as two
          overlapping photos than one.
        </p>
        <!-- Two separate inputs on purpose: capture="environment" on iOS
             removes the photo-library option entirely (the Shelfie lesson),
             so the camera and the library each get their own. -->
        <label class="pick-btn">
          📷 Photograph a receipt
          <input type="file" accept="image/*" capture="environment" @change="onFiles" hidden>
        </label>
        <label class="pick-btn secondary">
          🖼 Choose from library
          <input type="file" accept="image/*" multiple @change="onFiles" hidden>
        </label>
        <p v-if="errorMessage" class="scan-error">{{ errorMessage }}</p>
      </div>

      <!-- Scanning -->
      <div v-else-if="stage === 'scanning'" class="scanning-stage">
        <div class="scan-spinner"></div>
        <p class="scanning-text">Reading your groceries…</p>
        <p class="scanning-sub">
          {{ photoProgress }} · this takes about a minute per photo
        </p>
      </div>

      <!-- What it did. NOT a confirmation — Matt, 2026-09-20: "I want the
           receipt to just get interpreted, and I'm just going to assume you
           got it right. I don't want any kind of checks." A receipt read in
           the car park is not a form to fill in. This screen has no decision
           on it; it is a receipt for a receipt.

           The printed line still rides on every row, because that is the only
           way a misexpanded abbreviation is ever catchable — but as something
           to notice, not something to approve. -->
      <div v-else-if="stage === 'done'" class="review-stage">
        <p v-if="receiptNote" class="receipt-note">🧾 {{ receiptNote }}</p>
        <!-- The Done button sits at the TOP. Matt, 2026-09-20: "the done
             button should be at the top so I don't have to scroll through it
             all if I don't want to." The list below is there to be read if he
             wants it, not waded through to get out. Sticky, so it stays
             reachable once he does start scrolling. -->
        <div class="done-bar">
          <p class="done-line">{{ doneMessage }}</p>
          <button class="done-btn" @click="$emit('close')">Done</button>
        </div>

        <ul v-if="reviewItems.length" class="seen-list">
          <li v-for="(item, index) in reviewItems" :key="index" class="seen-row">
            <span class="seen-tick">+</span>
            <span class="seen-body">
              <span class="seen-title">{{ item.name }}</span>
              <span v-if="item.printedText" class="seen-printed">{{ item.printedText }}</span>
            </span>
            <span class="seen-left">
              {{ item.shelfStable ? 'pantry' : formatDays(item.days) }}
            </span>
          </li>
        </ul>

        <p v-if="nothingFound" class="scan-error">No food found in that photo.</p>

        <template v-if="skippedItems.length">
          <h3 class="pile-head">Skipped</h3>
          <ul class="unclear-list">
            <li v-for="(row, index) in skippedItems" :key="'s' + index">
              {{ row.what }}<template v-if="row.why"> — {{ row.why }}</template>
            </li>
          </ul>
        </template>

      </div>
    </div>
  </div>

</template>

<script>
import { preparePhoto } from '@/utils/fridge/photo'
import { scanPhoto, ScanError } from '@/utils/fridge/scan'
import { ensureSession } from '@/firebase'
import {
  buildReviewList,
  confirmPayload,
  isStorageScan
} from '@/store/fridge/scanReview'
import { formatDaySpan } from '@/store/fridge/timers'
import { knownFoodNames } from '@/store/fridge/vocabulary'
import { markBusy, clearBusy } from '@/utils/appUpdate'

// The reason string this sheet registers with the auto-update machinery.
const BUSY_REASON = 'fridge-scan'

export default {
  name: 'ScanFlow',
  props: {
    householdKey: { type: String, required: true },
    timers: { type: Array, default: () => [] }
  },
  emits: ['close', 'confirm'],
  mounted () {
    // No auto-update while this sheet is open. A half-reviewed scan lives
    // only in memory: a reload mid-review throws away the photos, the model's
    // reading (already paid for) and every rename and tick so far. The sheet
    // is transient — the hold lifts the moment it closes.
    markBusy(BUSY_REASON)
  },
  beforeUnmount () {
    clearBusy(BUSY_REASON)
  },
  data () {
    return {
      stage: 'pick',
      errorMessage: '',
      photosDone: 0,
      photosTotal: 0,
      photos: [], // prepared photos, kept for cropping
      reviewItems: [],
      crops: {},
      newCrops: {},
      scans: [],
      // The duration presets are gone: nothing asks for a duration any more.
    }
  },
  computed: {
    title () {
      if (this.stage === 'done') return 'From the receipt'
      return 'Scan a receipt'
    },
    obscuredCount () {
      return this.scans.reduce((total, scan) => total + (scan.obscured || 0), 0)
    },
    photoProgress () {
      return this.photosTotal > 1
        ? `photo ${Math.min(this.photosDone + 1, this.photosTotal)} of ${this.photosTotal}`
        : 'one photo'
    },
    nothingFound () {
      return this.stage === 'done' && this.reviewItems.length === 0
    },
    templates () {
      return this.$store.getters['fridge/templates']
    },
    // Named so a receipt is obviously understood as a receipt, and so a
    // backdated batch says why the timers look short.
    // A statement of what happened, not a question.
    doneMessage () {
      const n = this.reviewItems.length
      if (!n) return 'Nothing on that photo looked like food.'
      const pantry = this.reviewItems.filter((item) => item.shelfStable).length
      const fridge = n - pantry
      const parts = []
      if (fridge) parts.push(`${fridge} on the timers`)
      if (pantry) parts.push(`${pantry} in the pantry`)
      return `Added ${parts.join(' and ')}.`
    },

    // What the scan deliberately left out. Worth saying: a household that
    // cannot see what was skipped cannot tell "it ignored the detergent" from
    // "it missed the chicken".
    skippedItems () {
      return this.scans.flatMap((scan) => scan.skipped || [])
    },

    receiptNote () {
      const receipt = this.scans.find((scan) => scan.photoKind === 'receipt')
      if (!receipt) return ''
      const backdated = this.reviewItems.find((item) => item.daysElapsed > 0)
      if (!backdated) return 'Read as a receipt.'
      const days = backdated.daysElapsed
      return `Read as a receipt from ${this.formatDate(backdated.startsAt)} — ${days} day${days === 1 ? '' : 's'} ago, so these timers start from then.`
    }
  },
  methods: {
    // A CURRENT token, fetched per scan rather than held.
    //
    // Firebase ID tokens last an hour, and a wall tablet sits on this page for
    // weeks. One captured at mount would be long dead by the time anyone
    // photographed a shopping bag, and the failure looks like a rejected key
    // rather than an expired session. getIdToken() returns the cached one and
    // refreshes only when it is close to expiry, so this is cheap.
    async freshIdToken () {
      const user = await ensureSession();
      return user ? user.getIdToken() : '';
    },
    // On change (blur/enter), not on every keystroke: snapping the text to a
    // template's title mid-word would fight the typing.
    formatDays (days) {
      return formatDaySpan(days)
    },

    // Where this guess came from, in four words. Not a decision to make — a
    // claim that can be checked, which is what makes a wrong one correctable
    // instead of mysterious.
    daysSource (item) {
      if (item.printedDays && item.days === item.printedDays) return 'printed on the pack'
      if (item.fromTemplate) return 'what yours usually lasts'
      return 'best guess'
    },
    formatDate (date) {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    },
    remainingLabel (item) {
      const left = item.days - item.daysElapsed
      if (left <= 0) return `${formatDaySpan(item.days)} from purchase — already past`
      return `${formatDaySpan(item.days)} from purchase — ${formatDaySpan(left)} left`
    },
    tryClose () {
      // Mid-scan the server keeps working either way, but a stray tap must
      // not look like it cancelled a scan that is still being paid for.
      if (this.stage !== 'scanning') this.$emit('close')
    },
    async onFiles (event) {
      const files = Array.from(event.target.files || [])
      if (!files.length) return
      this.errorMessage = ''
      this.stage = 'scanning'
      this.photosTotal = files.length
      this.photosDone = 0

      // BOTH vocabularies, same as the talk-through — see vocabulary.js. A
      // receipt line expanded to a name the CATALOG doesn't know creates a
      // timer that joins to nothing, so the shopping list goes on asking for
      // food that is in the bag you just carried in. Templates alone was the
      // old behaviour and it is what let "box of rotini" become "Rotini Pasta".
      const knownFoods = knownFoodNames({
        templates: this.templates,
        catalog: this.$store.state.groceryCatalog || {},
        shoppingList: this.$store.state.shoppingList || {}
      })
      const scans = []
      try {
        for (const file of files) {
          const photo = await preparePhoto(file)
          this.photos.push(photo)
          const result = await scanPhoto(photo, {
            householdKey: this.householdKey,
            idToken: await this.freshIdToken(),
            knownFoods
          })
          scans.push(result)
          this.photosDone += 1
        }
      } catch (error) {
        this.stage = 'pick'
        this.photos = []
        this.errorMessage = error instanceof ScanError
          ? error.message
          : 'Something went wrong reading that photo.'
        return
      }

      this.scans = scans
      const now = new Date()

      // A photo of the FRIDGE is no longer a thing this flow does. Talking
      // through the kitchen replaced it, and doing it silently by photo would
      // be the part Matt said he didn't trust. Say what happened instead of
      // quietly running the retired flow.
      //
      // (`buildReconcile` and its 15 tests stay in scanReview.js, and the
      // reconcile stage stays in this template — re-importing it and calling
      // it here is the whole of bringing the flow back. Delete both once the
      // spoken inventory has a few real weeks behind it, not before it has
      // actually replaced anything.)
      if (scans.some(isStorageScan)) {
        this.errorMessage = 'That looks like the inside of a fridge rather than a receipt. Use "Talk through the kitchen" for that now.'
        this.stage = 'pick'
        return
      }

      this.reviewItems = buildReviewList(scans, this.templates, now)

      // NO CONFIRMATION STEP. Read it, apply it, say what happened. Matt,
      // 2026-09-20: "I want the receipt to just get interpreted, and I'm just
      // going to assume you got it right." A receipt read in a car park is
      // not a form to fill in, and every row was ticked by default anyway —
      // the screen was only ever a place to change one's mind.
      this.$emit('confirm', confirmPayload(this.reviewItems, now))
      this.stage = 'done'
    },
    // Re-cut from that source. The review thumbnail is capped at 480px on its
    // long edge, so scaling THAT up would just show bigger blur.
    // Magnifying scrolls a bigger image inside a fixed box, and a scroll box
    // starts at its top-left — which on a crop is empty background. The
    // subject is in the middle, so start there.
    leftLabel (row) {
      if (!row.timeLeft) return ''
      if (row.timeLeft.expired) return 'expired'
      return row.timeLeft.days > 0 ? `${formatDaySpan(row.timeLeft.days)} left` : 'today'
    },
    confirm () {
      if (!this.ready) return
      this.$emit('confirm', confirmPayload(this.reviewItems, new Date()))
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
    color: var(--fr-text);
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

.pick-stage {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  .pick-hint {
    color: var(--fr-muted);
    margin-bottom: 0.5rem;
  }

  .pick-btn {
    display: block;
    text-align: center;
    padding: 1.25rem;
    background: var(--fr-accent);
    color: var(--fr-text);
    border-radius: 8px;
    font-size: 1.1rem;
    font-weight: 500;
    cursor: pointer;

    &.secondary {
      background: var(--fr-field);
      border: 1px solid var(--fr-line);
    }
  }
}

.scanning-stage {
  text-align: center;
  padding: 2rem 0;

  .scan-spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 1.5rem;
    border: 4px solid var(--fr-line);
    border-top-color: var(--fr-accent);
    border-radius: 50%;
    animation: scan-spin 0.9s linear infinite;
  }

  .scanning-text {
    color: var(--fr-text);
    font-size: 1.2rem;
    margin-bottom: 0.5rem;
  }

  .scanning-sub {
    color: var(--fr-muted);
    font-size: 0.9rem;
  }
}

@keyframes scan-spin {
  to { transform: rotate(360deg); }
}

.review-stage {
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

  .seen-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  /* The receipt line exactly as printed. Still here, and still the only way a
     misexpanded abbreviation is ever catchable — but as something to notice,
     not something to approve. */
  .seen-printed {
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.7rem;
    color: var(--fr-faint);
  }

  .unclear-list {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--fr-faint);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .pile-head {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 1.25rem 0 0.4rem;
    color: var(--fr-text);
  }

  .pile-note {
    font-size: 0.82rem;
    color: var(--fr-muted);
    margin-bottom: 0.75rem;
  }

  .gone-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.75rem;
    margin-bottom: 0.5rem;
    border: 1px solid var(--fr-line);
    border-radius: 10px;
    cursor: pointer;

    &.picked {
      border-color: rgba(245, 101, 101, 0.7);
      background: rgba(245, 101, 101, 0.12);
    }

    .gone-title {
      font-size: 1rem;
      color: var(--fr-text);
    }

    .gone-context {
      margin-left: auto;
      font-size: 0.78rem;
      color: var(--fr-faint);
      text-align: right;
    }
  }

  .still-here {
    margin-top: 1rem;
    font-size: 0.85rem;
    color: var(--fr-faint);
  }

  // Deliberately tighter than the piles below it — nothing here needs doing,
  // so a dozen of them shouldn't push the actual decisions off the screen.
  .seen-list {
    list-style: none;
    margin: 0 0 0.5rem;
    padding: 0;
  }

  .seen-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.28rem 0.2rem;
    border-bottom: 1px solid var(--fr-line);

    .seen-tick {
      color: rgba(72, 187, 120, 0.9);
      font-size: 0.85rem;
    }

    .seen-title {
      font-size: 0.92rem;
      color: var(--fr-text);
    }

    .seen-left {
      margin-left: auto;
      font-size: 0.75rem;
      color: var(--fr-faint);
      white-space: nowrap;
    }
  }

  .receipt-note {
    background: var(--fr-accent);
    border: 1px solid var(--fr-accent);
    border-radius: 8px;
    padding: 0.7rem 0.85rem;
    margin-bottom: 0.85rem;
    font-size: 0.9rem;
    color: var(--fr-text);
  }

  .review-hint {
    color: var(--fr-muted);
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .review-row {
    border: 1px solid var(--fr-line);
    border-radius: 10px;
    padding: 0.75rem;
    margin-bottom: 0.75rem;

    &.excluded {
      opacity: 0.45;
    }
  }

  .review-top {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .review-check {
    width: 20px;
    height: 20px;
    accent-color: var(--fr-accent);
    flex-shrink: 0;
  }

  .review-crop-btn {
    padding: 0;
    border: 1px solid var(--fr-line);
    border-radius: 7px;
    background: none;
    line-height: 0;
    flex-shrink: 0;

    &:hover, &:focus-visible {
      border-color: var(--fr-muted);
    }
  }

  .review-crop {
    width: 64px;
    height: 48px;
    object-fit: cover;
    border-radius: 6px;
    display: block;
    background: var(--fr-field);
  }

  .review-name {
    flex: 1;
    min-width: 0;
    padding: 0.5rem;
    background: var(--fr-field);
    border: 1px solid var(--fr-line);
    border-radius: 6px;
    color: var(--fr-text);
    font-size: 1rem;
  }

  .review-printed {
    margin-top: 0.5rem;
    margin-left: 2rem;
    font-family: "IBM Plex Mono", monospace;
    font-size: 0.78rem;
    letter-spacing: 0.02em;
    color: var(--fr-faint);
  }

  .review-readas {
    align-self: center;
    font-size: 0.78rem;
    color: #f0b849;
  }

  .review-elapsed {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: var(--fr-muted);
  }

  .review-durations {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  /* Where a guess came from. Not a decision — a claim that can be checked,
     which is what makes a wrong one correctable instead of mysterious. */
  .days-from {
    font-size: 0.75rem;
    color: var(--fr-faint);
  }

  /* Not a chip you can press — a statement that this row needs no decision. */
  .pantry-chip {
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--fr-line);
    border-radius: 999px;
    color: var(--fr-muted);
    font-size: 0.8rem;
  }

  .duration-chip {
    padding: 0.45rem 0.7rem;
    background: var(--fr-field);
    border: 1px solid var(--fr-line);
    border-radius: 999px;
    color: var(--fr-text);
    font-size: 0.85rem;
    cursor: pointer;

    &.active {
      background: var(--fr-accent);
      border-color: var(--fr-accent);
    }
  }

  .review-actions {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
    margin-top: 1.25rem;

    .cancel-btn, .confirm-btn {
      padding: 1rem 1.5rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
    }

    .cancel-btn {
      background: var(--fr-field);
      color: var(--fr-text);
      border: 1px solid var(--fr-line);
    }

    .confirm-btn {
      background: var(--fr-accent);
      color: var(--fr-text);

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
}

.scan-error {
  color: #f56565;
  margin-top: 0.75rem;
}

/* Look closer. Above the review sheet, so a stray tap can't dismiss the
   half-reviewed list underneath it. */

/* Fill the space rather than merely fitting inside it: a crop of one item is
   often only a few hundred pixels, and showing it at native size defeats the
   entire point of tapping it. object-fit keeps the aspect ratio. */
</style>
