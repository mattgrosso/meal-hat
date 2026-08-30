<template>
  <div class="fridge-app">
    <!-- Not connected: no fridge key, or the database refused ours. On a wall
         display this must be LOUD — a quiet failure is an invisible one, and
         nobody notices a blank kitchen screen for a week. -->
    <div v-if="notConnected" class="not-connected">
      <div class="not-connected-title">THE FRIDGE ISN'T CONNECTED</div>
      <div class="not-connected-text">{{ notConnectedReason }}</div>
      <!-- Recovery without needing anyone to hand over the secret again:
           paste the setup link (or just the key) from any device that has it. -->
      <form class="reconnect" @submit.prevent="reconnect">
        <input
          v-model="pastedKey"
          type="text"
          class="reconnect-input"
          placeholder="Paste the setup link here"
          autocomplete="off"
          spellcheck="false"
        >
        <button type="submit" class="reconnect-btn" :disabled="!pastedKeyValid">Reconnect</button>
      </form>
      <p v-if="pastedKey && !pastedKeyValid" class="reconnect-hint">
        That doesn't have a key in it — paste the whole link, the one containing
        <code>?k=…</code>
      </p>
    </div>

    <div v-else-if="loading && timers.length === 0" class="loading">
      <div class="loading-text">Loading timers...</div>
    </div>

    <div v-else-if="error" class="error">
      <div class="error-text">{{ error }}</div>
      <button class="retry-btn" @click="connect">Retry Connection</button>
    </div>

    <!-- The phone: a capture surface first. -->
    <PhoneView
      v-else-if="isPhone"
      :just-added="justAdded"
      @scan="showScan = true"
      @add="showAddForm = true"
      @history="showHistory = true"
    />

    <!-- The wall display -->
    <div v-else class="timers-grid">
      <CountdownTimer
        v-for="timer in timers"
        :key="timer.id"
        :timer="timer"
        @remove="removeTimer"
      />
      <AddTimerButton @add-timer="showAddForm = true" />
    </div>

    <AddTimerModal
      v-if="showAddForm"
      @close="showAddForm = false"
      @add-timer="addTimer"
    />

    <ScanFlow
      v-if="showScan"
      :household-key="fridgeKey"
      :timers="timers"
      @close="showScan = false"
      @confirm="confirmScan"
      @reconcile="confirmReconcile"
    />

    <!-- The change log. Read-only; it answers "where did that come from?" -->
    <HistorySheet v-if="showHistory" @close="showHistory = false" />

    <!-- The wall display's look is deliberately untouched, so the way in to
         the log there is the build stamp that was already in the corner. -->
    <button
      class="build-stamp"
      :disabled="notConnected"
      title="What's changed"
      @click="showHistory = true"
    >{{ stamp }}</button>
  </div>
</template>

<script>
import CountdownTimer from './fridge/CountdownTimer.vue';
import AddTimerButton from './fridge/AddTimerButton.vue';
import AddTimerModal from './fridge/AddTimerModal.vue';
import ScanFlow from './fridge/ScanFlow.vue';
import PhoneView from './fridge/PhoneView.vue';
import HistorySheet from './fridge/HistorySheet.vue';
import { adoptFridgeKey, extractKey, storeFridgeKey } from '@/utils/fridge/fridgeKey';
import { resolveViewMode } from '@/utils/fridge/viewMode';
import { buildStamp } from '@/utils/buildStamp';

export default {
  name: 'Fridge',
  components: {
    CountdownTimer,
    AddTimerButton,
    AddTimerModal,
    ScanFlow,
    PhoneView,
    HistorySheet
  },
  data () {
    return {
      showAddForm: false,
      showScan: false,
      showHistory: false,
      missingKey: false,
      viewMode: 'wall',
      justAdded: '',
      pastedKey: '',
      stamp: buildStamp(),
      // Once per visit. The watcher below fires whenever either side's
      // subscription updates, and re-running the merge on every snapshot would
      // write the catalog repeatedly for no gain.
      reconciled: false
    };
  },
  computed: {
    isPhone () {
      return this.viewMode === 'phone';
    },
    fridgeKey () {
      return this.$store.state.fridge.fridgeKey;
    },
    timers () {
      return this.$store.getters['fridge/allTimers'];
    },
    loading () {
      return this.$store.state.fridge.loading;
    },
    error () {
      return this.$store.state.fridge.error === 'unauthorized' ? null : this.$store.state.fridge.error;
    },
    notConnected () {
      return this.missingKey || this.$store.state.fridge.error === 'unauthorized';
    },
    // Say which of the two it actually is. The old copy claimed "no key" even
    // when the key was present and the database had refused it, which sent you
    // looking for the wrong problem.
    notConnectedReason () {
      return this.missingKey
        ? 'This device has no fridge key yet.'
        : 'The fridge key on this device was refused. It may have been replaced.';
    },
    pastedKeyValid () {
      return Boolean(extractKey(this.pastedKey));
    },
    // Both halves loaded, and a signed-in user to do the writing. The wall
    // tablet can never satisfy this — it is a member of no hat and cannot read
    // or write the catalog — which is exactly the intent.
    canReconcile () {
      return Boolean(
        this.$store.state.databaseTopKey &&
        Object.keys(this.$store.state.groceryCatalog || {}).length &&
        Object.keys(this.$store.state.fridge.templates || {}).length
      );
    }
  },
  watch: {
    // Runs once, when both sides have actually arrived — not on a timer and
    // not on mount. Both are async subscriptions and either can land second;
    // reconciling against a half-loaded catalog would read every food as new.
    canReconcile: {
      immediate: true,
      handler (ready) {
        if (!ready || this.reconciled) return;
        this.reconciled = true;
        this.$store.dispatch('fridge/reconcileCatalog');
      }
    }
  },
  mounted () {
    // The dark full-bleed look belongs to this screen only. Perishable set it
    // on `body` from an unscoped stylesheet, which is fine when the app is the
    // whole page and ruinous here — it would repaint every meal-hat screen and
    // fight Bootstrap's reboot. A class on body, added and removed with the
    // route, keeps the wall display looking exactly as it did.
    document.body.classList.add('fridge-active');

    this.viewMode = resolveViewMode();
    this.connect();
  },
  beforeUnmount () {
    document.body.classList.remove('fridge-active');
    clearTimeout(this.justAddedTimer);
  },
  methods: {
    // Two doors to the same fridge. The kiosk arrives holding the key in its
    // URL; a signed-in phone has no key in the address bar and looks up the
    // hat's pointer instead, so the secret never has to be pasted onto a
    // device that is already authenticated.
    connect () {
      const key = adoptFridgeKey() || this.$store.state.fridgeKeyForHat;
      if (key) {
        this.$store.dispatch('fridge/subscribe', key);
        this.missingKey = false;
      } else {
        this.missingKey = true;
      }
    },
    addTimer (timerData) {
      this.$store.dispatch('fridge/addTimer', {
        title: timerData.title,
        expiryDate: timerData.expiryDate,
        source: 'hand'
      });
      this.showAddForm = false;
      this.noteAdded(`Added ${timerData.title}`);
    },
    reconnect () {
      const key = extractKey(this.pastedKey);
      if (!key) return;
      storeFridgeKey(key);
      // A full reload rather than re-dispatching: it re-runs adoptFridgeKey,
      // which puts the key in the address bar, and clears any half-built state
      // from the failed attempt. The hash has to be carried explicitly —
      // assigning to location.search alone would drop the route.
      window.location.href = `${window.location.pathname}?k=${key}#/fridge`;
    },
    // The phone leads with the camera, so a write needs to say so out loud.
    noteAdded (message) {
      if (!this.isPhone) return;
      this.justAdded = message;
      clearTimeout(this.justAddedTimer);
      this.justAddedTimer = setTimeout(() => { this.justAdded = ''; }, 8000);
    },
    removeTimer (timerId) {
      this.$store.dispatch('fridge/removeTimer', { id: timerId, source: 'hand' });
    },
    async confirmScan ({ timers, templates }) {
      this.showScan = false;
      for (const timer of timers) {
        await this.$store.dispatch('fridge/addTimer', { ...timer, source: 'scan' });
      }
      // Each confirmed food teaches a template — the same learning loop a
      // hand-typed add runs.
      for (const template of templates) {
        await this.$store.dispatch('fridge/saveTemplate', { ...template, source: 'scan' });
      }
      this.noteAdded(`Added ${timers.length} timer${timers.length === 1 ? '' : 's'}`);
    },
    async confirmReconcile ({ timers, templates, removeIds }) {
      this.showScan = false;
      for (const timer of timers) {
        await this.$store.dispatch('fridge/addTimer', { ...timer, source: 'fridge' });
      }
      for (const template of templates) {
        await this.$store.dispatch('fridge/saveTemplate', { ...template, source: 'fridge' });
      }
      // Removals are only ever the ones deliberately ticked — see
      // buildReconcile for why absence from a photo is never enough.
      for (const id of removeIds) {
        await this.$store.dispatch('fridge/removeTimer', { id, source: 'fridge' });
      }
      const parts = [];
      if (timers.length) parts.push(`added ${timers.length}`);
      if (removeIds.length) parts.push(`removed ${removeIds.length}`);
      this.noteAdded(parts.length ? `Fridge updated — ${parts.join(', ')}` : 'Nothing changed');
    }
  }
};
</script>

<style lang="scss">
/* Deliberately NOT scoped, and deliberately narrow.
 *
 * This is a lazy-loaded route, so everything here lands in the fridge chunk
 * and no meal-hat screen pays for it. What it may not do is leak: perishable
 * owned the whole page and could style `body` and `*` outright. Here the
 * body-level rules hang off `.fridge-active`, which mounted()/beforeUnmount()
 * add and remove, and everything else is nested under `.fridge-app`.
 */
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&family=Roboto+Serif:ital,opsz,wght@0,8..144,100..900;1,8..144,100..900&display=swap');

body.fridge-active {
  font-family: 'Roboto Serif', serif;
  background: #000;
  color: #fff;

  /* Perishable's global reset, confined to the fridge. Bootstrap's reboot
   * still owns every other screen. */
  .fridge-app * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
}

.fridge-app {
  min-height: 100vh;
  width: 100%;
  padding: 16px;

  .timers-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    align-content: start;
  }

  .loading, .error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    text-align: center;
  }

  .loading-text, .error-text {
    font-size: 1.5rem;
    margin-bottom: 2rem;
    opacity: 0.8;
  }

  .not-connected {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    text-align: center;
    padding: 2rem;

    .not-connected-title {
      font-size: 3rem;
      font-weight: 700;
      color: #f56565;
      margin-bottom: 1.5rem;
    }

    .not-connected-text {
      font-size: 1.5rem;
      opacity: 0.85;
      max-width: 32rem;

      code {
        font-family: 'IBM Plex Mono', monospace;
      }
    }

    .reconnect {
      display: flex;
      gap: 0.75rem;
      margin-top: 2rem;
      width: 100%;
      max-width: 30rem;
      flex-wrap: wrap;
      justify-content: center;
    }

    .reconnect-input {
      flex: 1 1 16rem;
      min-width: 0;
      padding: 0.9rem 1rem;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      color: #fff;
      font-family: inherit;
      font-size: 1rem;

      &::placeholder {
        color: rgba(255, 255, 255, 0.45);
      }

      &:focus {
        outline: none;
        border-color: rgba(255, 255, 255, 0.6);
      }
    }

    .reconnect-btn {
      padding: 0.9rem 1.5rem;
      background: #4CAF50;
      border: none;
      border-radius: 8px;
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

    .reconnect-hint {
      margin-top: 0.75rem;
      font-size: 0.95rem;
      opacity: 0.6;

      code {
        font-family: 'IBM Plex Mono', monospace;
      }
    }
  }

  .retry-btn {
    padding: 1rem 2rem;
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 8px;
    color: #fff;
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: rgba(255, 255, 255, 0.3);
      border-color: rgba(255, 255, 255, 0.5);
    }
  }

  // Also the way into the change log. The padding-and-offset dance keeps the
  // glyphs at exactly the 4px/8px they always sat at while giving a finger on a
  // wall tablet something bigger than 10px type to hit.
  .build-stamp {
    position: fixed;
    bottom: -4px;
    left: 0;
    padding: 8px;
    font-size: 10px;
    opacity: 0.35;
    font-family: 'IBM Plex Mono', monospace;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;

    &:disabled {
      cursor: default;
    }
  }
}
</style>
