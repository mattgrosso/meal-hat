<template>
  <div class="modal-overlay" @click.self="tryClose">
    <div class="modal-content scan-content">
      <div class="modal-header">
        <h2>{{ title }}</h2>
        <button class="close-btn" @click="tryClose">×</button>
      </div>

      <!-- Pick photos -->
      <div v-if="stage === 'pick'" class="pick-stage">
        <p class="pick-hint">
          Photograph the groceries, the receipt, or the inside of the fridge or
          cupboard — it works out which for itself. A long receipt reads better
          as two overlapping photos than one.
        </p>
        <!-- Two separate inputs on purpose: capture="environment" on iOS
             removes the photo-library option entirely (the Shelfie lesson),
             so the camera and the library each get their own. -->
        <label class="pick-btn">
          📷 Take a photo
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

      <!-- Reconcile review: a fridge or cupboard photo -->
      <div v-else-if="stage === 'reconcile'" class="review-stage">
        <p class="receipt-note">🧊 Read as a fridge or cupboard — checking it against what you're tracking.</p>

        <!-- Named, not counted. This pile is the receipt for the whole scan:
             seeing your own food listed back is what makes the result
             trustworthy, and a comma-run-on of 12 names doesn't do that. -->
        <template v-if="reconcile.stillHere.length">
          <h3 class="pile-head">Saw {{ reconcile.stillHere.length }} you're already tracking</h3>
          <ul class="seen-list">
            <li v-for="row in reconcile.stillHere" :key="row.id" class="seen-row">
              <span class="seen-tick">✓</span>
              <span class="seen-title">{{ row.title }}</span>
              <span class="seen-left">{{ leftLabel(row) }}</span>
            </li>
          </ul>
        </template>

        <template v-if="reconcile.newItems.length">
          <h3 class="pile-head">Not tracked yet — add these?</h3>
          <div v-for="(item, index) in reconcile.newItems" :key="'new' + index" class="review-row" :class="{ excluded: !item.included }">
            <div class="review-top">
              <input type="checkbox" v-model="item.included" class="review-check">
              <button
                v-if="newCrops[index]"
                type="button"
                class="review-crop-btn"
                :title="`Look closer at ${item.name}`"
                @click="openZoom(item)"
              >
                <img :src="newCrops[index]" class="review-crop" alt="">
              </button>
              <input type="text" v-model="item.name" class="review-name" :disabled="!item.included">
            </div>
            <!-- Same chips as the haul review: a template match has to SAY it
                 is one, or a 51-day shelf life rides along invisibly. -->
            <div v-if="item.included" class="review-durations">
              <button v-if="item.fromTemplate" class="duration-chip active">{{ formatDays(item.days) }} (your usual)</button>
              <span v-if="item.readAs" class="review-readas">read as “{{ item.readAs }}” — using your {{ item.name }}</span>
              <template v-else-if="!item.fromTemplate">
                <button v-if="item.printedDays" class="duration-chip" :class="{ active: item.days === item.printedDays }" @click="item.days = item.printedDays">printed: {{ item.printedDate }}</button>
                <button v-if="item.estimateDays" class="duration-chip" :class="{ active: item.days === item.estimateDays }" @click="item.days = item.estimateDays">typical: {{ formatDays(item.estimateDays) }}</button>
                <button v-for="preset in presets" :key="preset" class="duration-chip" :class="{ active: item.days === preset }" @click="item.days = preset">{{ formatDays(preset) }}</button>
              </template>
            </div>
          </div>
        </template>

        <template v-if="reconcile.maybeGone.length">
          <h3 class="pile-head">Didn't see these — eaten?</h3>
          <p class="pile-note">
            Only what's in this photo counts as seen, so anything on another
            shelf, in a drawer, or behind something else lands here too. Tick
            only what you know is gone.
          </p>
          <label v-for="row in reconcile.maybeGone" :key="row.id" class="gone-row" :class="{ picked: row.remove }">
            <input type="checkbox" v-model="row.remove" class="review-check">
            <span class="gone-title">{{ row.title }}</span>
            <span class="gone-context">{{ goneContext(row) }}</span>
          </label>
        </template>

        <p v-if="obscuredCount" class="pile-note">
          {{ obscuredCount }} thing{{ obscuredCount === 1 ? '' : 's' }} in the photo
          couldn't be identified — they're not counted either way.
        </p>
        <p v-if="!reconcile.newItems.length && !reconcile.maybeGone.length" class="still-here">
          Everything matches what you're already tracking.
        </p>

        <div class="review-actions">
          <button class="cancel-btn" @click="$emit('close')">Cancel</button>
          <button class="confirm-btn" :disabled="!reconcileReadyNow" @click="confirmReconcile">
            {{ reconcileButtonLabel }}
          </button>
        </div>
      </div>

      <!-- Review -->
      <div v-else-if="stage === 'review'" class="review-stage">
        <p v-if="receiptNote" class="receipt-note">🧾 {{ receiptNote }}</p>
        <p class="review-hint">
          Uncheck anything that's wrong. New foods need a time picked before they can be added.
        </p>
        <div v-for="(item, index) in reviewItems" :key="index" class="review-row" :class="{ excluded: !item.included }">
          <div class="review-top">
            <input type="checkbox" v-model="item.included" class="review-check">
            <!-- No crop on a receipt row: a cut-out of one printed line is a
                 smear of blank paper. The mono line below is the evidence. -->
            <button
              v-if="crops[index] && !item.printedText"
              type="button"
              class="review-crop-btn"
              :title="`Look closer at ${item.name}`"
              @click="openZoom(item)"
            >
              <img :src="crops[index]" class="review-crop" alt="">
            </button>
            <input type="text" v-model="item.name" class="review-name" :disabled="!item.included">
          </div>
          <!-- The receipt line as printed, so a bad expansion is catchable. -->
          <p v-if="item.printedText" class="review-printed">{{ item.printedText }}</p>
          <div v-if="item.included" class="review-durations">
            <button
              v-if="item.fromTemplate"
              class="duration-chip active"
            >{{ formatDays(item.days) }} (your usual)</button>
            <span v-if="item.readAs" class="review-readas">
              read as “{{ item.readAs }}” — using your {{ item.name }}
            </span>
            <template v-else>
              <button
                v-if="item.printedDays"
                class="duration-chip"
                :class="{ active: item.days === item.printedDays }"
                @click="item.days = item.printedDays"
              >printed: {{ item.printedDate }} ({{ formatDays(item.printedDays) }})</button>
              <button
                v-if="item.estimateDays"
                class="duration-chip"
                :class="{ active: item.days === item.estimateDays }"
                @click="item.days = item.estimateDays"
              >typical: {{ formatDays(item.estimateDays) }}</button>
              <button
                v-for="preset in presets"
                :key="preset"
                class="duration-chip"
                :class="{ active: item.days === preset }"
                @click="item.days = preset"
              >{{ formatDays(preset) }}</button>
            </template>
          </div>
          <!-- Backdating is invisible arithmetic; say it out loud. -->
          <p v-if="item.included && item.daysElapsed > 0 && item.days" class="review-elapsed">
            {{ remainingLabel(item) }}
          </p>
        </div>
        <p v-if="nothingFound" class="scan-error">No food found in that photo.</p>
        <div class="review-actions">
          <button class="cancel-btn" @click="$emit('close')">Cancel</button>
          <button class="confirm-btn" :disabled="!ready" @click="confirm">
            Add {{ includedCount }} timer{{ includedCount === 1 ? '' : 's' }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Look closer. The thumbnail is 64px wide, which is not enough to tell a
       cheddar from a mozzarella; this re-cuts the SAME box out of the full
       photo at full resolution rather than blowing up the thumbnail. -->
  <div v-if="zoom.open" class="zoom-overlay" @click.self="closeZoom">
    <div class="zoom-bar">
      <span class="zoom-name">{{ zoom.name }}</span>
      <button type="button" class="zoom-toggle" @click="zoom.whole = !zoom.whole">
        {{ zoom.whole ? 'Just this item' : 'Whole photo' }}
      </button>
      <button type="button" class="zoom-close" @click="closeZoom">×</button>
    </div>
    <div ref="zoomScroll" class="zoom-scroll" :class="{ magnified: zoom.magnified }" @click.self="closeZoom">
      <img
        v-if="zoom.src"
        :src="zoom.src"
        class="zoom-image"
        :alt="zoom.name"
        @click="toggleMagnify"
      >
      <p v-else class="zoom-loading">Loading…</p>
    </div>
    <p class="zoom-hint">{{ zoom.magnified ? 'Tap the picture to fit it again' : 'Tap the picture to magnify' }}</p>
  </div>
</template>

<script>
import { preparePhoto, renderAtEdge } from '@/utils/fridge/photo'
import { cropToDataUrl } from '@/utils/fridge/crop'
import { scanPhoto, ScanError } from '@/utils/fridge/scan'
import { ensureSession } from '@/firebase'
import {
  buildReviewList,
  reviewReady,
  confirmPayload,
  buildReconcile,
  reconcileReady,
  isStorageScan
} from '@/store/fridge/scanReview'
import { formatDaySpan } from '@/store/fridge/timers'

// How large to re-render an original photo for the close-up view. Beyond
// this a phone photo costs seconds of canvas work and tens of megabytes of
// data URL for detail no one is looking for.
const ZOOM_EDGE = 2600

export default {
  name: 'ScanFlow',
  props: {
    householdKey: { type: String, required: true },
    timers: { type: Array, default: () => [] }
  },
  emits: ['close', 'confirm', 'reconcile'],
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
      reconcile: { stillHere: [], newItems: [], maybeGone: [] },
      zoom: { open: false, src: '', name: '', item: null, whole: false, magnified: false },
      presets: [3, 5, 7, 10, 14]
    }
  },
  computed: {
    title () {
      if (this.stage === 'review') return 'Check the list'
      if (this.stage === 'reconcile') return "What's in there"
      return 'Scan groceries'
    },
    obscuredCount () {
      return this.scans.reduce((total, scan) => total + (scan.obscured || 0), 0)
    },
    reconcileReadyNow () {
      return reconcileReady(this.reconcile.newItems)
    },
    reconcileButtonLabel () {
      const adds = this.reconcile.newItems.filter((item) => item.included).length
      const removes = this.reconcile.maybeGone.filter((row) => row.remove).length
      const parts = []
      if (adds) parts.push(`Add ${adds}`)
      if (removes) parts.push(`remove ${removes}`)
      return parts.length ? parts.join(', ') : 'Done'
    },
    photoProgress () {
      return this.photosTotal > 1
        ? `photo ${Math.min(this.photosDone + 1, this.photosTotal)} of ${this.photosTotal}`
        : 'one photo'
    },
    ready () {
      return reviewReady(this.reviewItems)
    },
    includedCount () {
      return this.reviewItems.filter((item) => item.included).length
    },
    nothingFound () {
      return this.stage === 'review' && this.reviewItems.length === 0
    },
    templates () {
      return this.$store.getters['fridge/templates']
    },
    // Named so a receipt is obviously understood as a receipt, and so a
    // backdated batch says why the timers look short.
    receiptNote () {
      const receipt = this.scans.find((scan) => scan.photoKind === 'receipt')
      if (!receipt) return ''
      const backdated = this.reviewItems.find((item) => item.daysElapsed > 0)
      if (!backdated) return 'Read as a receipt.'
      const days = backdated.daysElapsed
      return `Read as a receipt from ${this.formatDate(backdated.startsAt)} — ${days} day${days === 1 ? '' : 's'} ago, so these timers start from then.`
    }
  },
  watch: {
    // Switching between the item and the whole photo re-renders in place.
    'zoom.whole' () {
      this.zoom.magnified = false
      // Deliberately not awaited — the watcher must not block on a re-render.
      this.renderZoom()
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
    formatDays (days) {
      return formatDaySpan(days)
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
      // Mid-scan the server keeps working either way; closing is safe but
      // deliberate — no click-outside dismissal of a half-reviewed list.
      if (this.stage !== 'review' && this.stage !== 'reconcile') this.$emit('close')
    },
    async onFiles (event) {
      const files = Array.from(event.target.files || [])
      if (!files.length) return
      this.errorMessage = ''
      this.stage = 'scanning'
      this.photosTotal = files.length
      this.photosDone = 0

      const knownFoods = this.templates.map((t) => t.title)
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

      // A fridge or cupboard shot is a different question — what's still
      // there — so it gets the reconcile screen instead of the add list.
      if (scans.some(isStorageScan)) {
        this.reconcile = buildReconcile(scans, this.timers, this.templates, now)
        this.stage = 'reconcile'
        this.buildNewCrops() // deliberately not awaited
        return
      }

      this.reviewItems = buildReviewList(scans, this.templates, now)
      this.stage = 'review'
      this.buildCrops() // deliberately not awaited
    },
    async buildNewCrops () {
      for (let i = 0; i < this.reconcile.newItems.length; i++) {
        const item = this.reconcile.newItems[i]
        const photo = this.photos[item.photoIndex]
        if (!photo || !item.box) continue
        try {
          const crop = await cropToDataUrl(photo.dataUrl, item.box)
          if (crop) this.newCrops = { ...this.newCrops, [i]: crop }
        } catch {
          // A row without a crop still shows its name.
        }
      }
    },
    async openZoom (item) {
      const photo = this.photos[item.photoIndex]
      if (!photo) return
      this.zoom = { open: true, src: '', name: item.name, item, whole: false, magnified: false }
      await this.renderZoom()
    },
    // The best available source for a close look: the ORIGINAL file
    // re-rendered large, not the 1568px copy that went to the API. Built once
    // per photo, and only if something is actually zoomed — a phone photo at
    // full size is several megabytes.
    async zoomSource (photo) {
      if (photo.zoomUrl) return photo.zoomUrl
      if (!photo.file) return photo.dataUrl
      try {
        photo.zoomUrl = await renderAtEdge(photo.file, ZOOM_EDGE)
      } catch {
        photo.zoomUrl = photo.dataUrl
      }
      return photo.zoomUrl
    },
    // Re-cut from that source. The review thumbnail is capped at 480px on its
    // long edge, so scaling THAT up would just show bigger blur.
    async renderZoom () {
      const item = this.zoom.item
      const photo = item && this.photos[item.photoIndex]
      if (!photo) return
      const source = await this.zoomSource(photo)
      // The overlay may have been closed or switched while that was rendering.
      if (!this.zoom.open || this.zoom.item !== item) return

      if (this.zoom.whole) {
        this.zoom.src = source
        return
      }
      try {
        this.zoom.src = await cropToDataUrl(source, item.box, { maxEdge: ZOOM_EDGE, quality: 0.92 })
      } catch {
        this.zoom.src = source
      }
    },
    // Magnifying scrolls a bigger image inside a fixed box, and a scroll box
    // starts at its top-left — which on a crop is empty background. The
    // subject is in the middle, so start there.
    async toggleMagnify () {
      this.zoom.magnified = !this.zoom.magnified
      if (!this.zoom.magnified) return
      await this.$nextTick()
      const box = this.$refs.zoomScroll
      if (!box) return
      box.scrollLeft = Math.max(0, (box.scrollWidth - box.clientWidth) / 2)
      box.scrollTop = Math.max(0, (box.scrollHeight - box.clientHeight) / 2)
    },
    closeZoom () {
      this.zoom = { open: false, src: '', name: '', item: null, whole: false, magnified: false }
    },
    leftLabel (row) {
      if (!row.timeLeft) return ''
      if (row.timeLeft.expired) return 'expired'
      return row.timeLeft.days > 0 ? `${formatDaySpan(row.timeLeft.days)} left` : 'today'
    },
    goneContext (row) {
      const parts = []
      if (row.addedDaysAgo === 0) parts.push('added today')
      else if (row.addedDaysAgo === 1) parts.push('added yesterday')
      else if (row.addedDaysAgo) parts.push(`added ${row.addedDaysAgo} days ago`)

      if (row.timeLeft?.expired) parts.push('already expired')
      else if (row.timeLeft) {
        const days = row.timeLeft.days
        parts.push(days > 0 ? `${formatDaySpan(days)} left` : 'less than a day left')
      }
      return parts.join(' · ')
    },
    confirmReconcile () {
      if (!this.reconcileReadyNow) return
      this.$emit('reconcile', {
        ...confirmPayload(this.reconcile.newItems, new Date()),
        removeIds: this.reconcile.maybeGone.filter((row) => row.remove).map((row) => row.id)
      })
    },
    async buildCrops () {
      for (let i = 0; i < this.reviewItems.length; i++) {
        const item = this.reviewItems[i]
        // Receipt rows show their printed line instead; skip the work.
        if (item.printedText) continue
        const photo = this.photos[item.photoIndex]
        if (!photo || !item.box) continue
        try {
          const crop = await cropToDataUrl(photo.dataUrl, item.box)
          if (crop) this.crops = { ...this.crops, [i]: crop }
        } catch {
          // A row without a crop still shows its name.
        }
      }
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

.pick-stage {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  .pick-hint {
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 0.5rem;
  }

  .pick-btn {
    display: block;
    text-align: center;
    padding: 1.25rem;
    background: #4CAF50;
    color: white;
    border-radius: 8px;
    font-size: 1.1rem;
    font-weight: 500;
    cursor: pointer;

    &.secondary {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
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
    border: 4px solid rgba(255, 255, 255, 0.15);
    border-top-color: #4CAF50;
    border-radius: 50%;
    animation: scan-spin 0.9s linear infinite;
  }

  .scanning-text {
    color: #fff;
    font-size: 1.2rem;
    margin-bottom: 0.5rem;
  }

  .scanning-sub {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.9rem;
  }
}

@keyframes scan-spin {
  to { transform: rotate(360deg); }
}

.review-stage {
  .pile-head {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 1.25rem 0 0.4rem;
    color: #fff;
  }

  .pile-note {
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.55);
    margin-bottom: 0.75rem;
  }

  .gone-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.75rem;
    margin-bottom: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 10px;
    cursor: pointer;

    &.picked {
      border-color: rgba(245, 101, 101, 0.7);
      background: rgba(245, 101, 101, 0.12);
    }

    .gone-title {
      font-size: 1rem;
      color: #fff;
    }

    .gone-context {
      margin-left: auto;
      font-size: 0.78rem;
      color: rgba(255, 255, 255, 0.5);
      text-align: right;
    }
  }

  .still-here {
    margin-top: 1rem;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.5);
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
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);

    .seen-tick {
      color: rgba(72, 187, 120, 0.9);
      font-size: 0.85rem;
    }

    .seen-title {
      font-size: 0.92rem;
      color: rgba(255, 255, 255, 0.9);
    }

    .seen-left {
      margin-left: auto;
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.45);
      white-space: nowrap;
    }
  }

  .receipt-note {
    background: rgba(76, 175, 80, 0.12);
    border: 1px solid rgba(76, 175, 80, 0.4);
    border-radius: 8px;
    padding: 0.7rem 0.85rem;
    margin-bottom: 0.85rem;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.9);
  }

  .review-hint {
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .review-row {
    border: 1px solid rgba(255, 255, 255, 0.2);
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
    accent-color: #4CAF50;
    flex-shrink: 0;
  }

  .review-crop-btn {
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 7px;
    background: none;
    line-height: 0;
    cursor: zoom-in;
    flex-shrink: 0;

    &:hover, &:focus-visible {
      border-color: rgba(255, 255, 255, 0.7);
    }
  }

  .review-crop {
    width: 64px;
    height: 48px;
    object-fit: cover;
    border-radius: 6px;
    display: block;
    background: rgba(255, 255, 255, 0.05);
  }

  .review-name {
    flex: 1;
    min-width: 0;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 6px;
    color: #fff;
    font-size: 1rem;
  }

  .review-printed {
    margin-top: 0.5rem;
    margin-left: 2rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
    letter-spacing: 0.02em;
    color: rgba(255, 255, 255, 0.45);
  }

  .review-readas {
    align-self: center;
    font-size: 0.78rem;
    color: #f0b849;
  }

  .review-elapsed {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .review-durations {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .duration-chip {
    padding: 0.45rem 0.7rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 999px;
    color: #fff;
    font-size: 0.85rem;
    cursor: pointer;

    &.active {
      background: #4CAF50;
      border-color: #4CAF50;
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
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.3);
    }

    .confirm-btn {
      background: #4CAF50;
      color: white;

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
.zoom-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.94);
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  gap: 0.6rem;
}

.zoom-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;

  .zoom-name {
    font-size: 1.15rem;
    font-weight: 600;
    color: #fff;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .zoom-toggle {
    padding: 0.5rem 0.85rem;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 999px;
    color: #fff;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .zoom-close {
    background: none;
    border: none;
    color: #fff;
    font-size: 2.2rem;
    line-height: 1;
    width: 44px;
    height: 44px;
    cursor: pointer;
  }
}

.zoom-scroll {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  -webkit-overflow-scrolling: touch;

  /* Magnified: overflow the box and pan around it, rather than fitting. */
  &.magnified {
    align-items: flex-start;
    justify-content: flex-start;

    .zoom-image {
      width: 250%;
      height: auto;
      flex-shrink: 0;
      cursor: zoom-out;
    }
  }
}

/* Fill the space rather than merely fitting inside it: a crop of one item is
   often only a few hundred pixels, and showing it at native size defeats the
   entire point of tapping it. object-fit keeps the aspect ratio. */
.zoom-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 8px;
  cursor: zoom-in;
}

.zoom-loading {
  color: rgba(255, 255, 255, 0.6);
}

.zoom-hint {
  flex-shrink: 0;
  text-align: center;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.45);
}
</style>
