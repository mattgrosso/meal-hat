<template>
  <div class="fridge-app" :class="viewMode">
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
      <!-- Or don't type anything here at all: a signed-in phone can hand this
           device the key against a code it can read off the wall. -->
      <div v-if="pairingCode" class="pair">
        <div class="pair-label">Or pair from your phone</div>
        <div class="pair-code">{{ pairingCodeSpaced }}</div>
        <div class="pair-hint">
          On your phone, open the fridge in Meal Hat, tap
          “Pair a wall display”, and enter this code.
        </div>
      </div>
    </div>

    <div v-else-if="awaitingHatKey" class="loading">
      <div class="loading-text">Finding your fridge...</div>
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
      @talk="showTalk = true"
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
    />

    <!-- The spoken inventory. Gets ALL timers, pantry included: this is the
         screen that decides what stays and what goes, and a timer the wall
         filters out must still be removable here. -->
    <TalkFlow
      v-if="showTalk"
      :household-key="fridgeKey"
      :timers="allTimers"
      @close="showTalk = false"
      @applied="onTalkApplied"
    />

    <!-- The change log. Read-only; it answers "where did that come from?" -->
    <HistorySheet v-if="showHistory" @close="showHistory = false" />

    <!-- The wall display's look is deliberately untouched, so the way in to
         the log THERE is the build stamp that was already in the corner.
         The phone has a "What's changed" button and the house header carries
         its own stamp, so showing this one too put two stamps on one screen. -->
    <button
      v-if="!isPhone"
      class="wall-stamp"
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
import TalkFlow from './fridge/TalkFlow.vue';
import PhoneView from './fridge/PhoneView.vue';
import HistorySheet from './fridge/HistorySheet.vue';
import { adoptFridgeKey, extractKey, storeFridgeKey, isValidKey, rememberKeyAlias } from '@/utils/fridge/fridgeKey';
import { generatePairingCode, urlWithKey } from '@/utils/fridge/pairing';
import { resolveViewMode } from '@/utils/fridge/viewMode';
import { buildStamp } from '@/utils/buildStamp';

export default {
  name: 'Fridge',
  components: {
    CountdownTimer,
    AddTimerButton,
    AddTimerModal,
    ScanFlow,
    TalkFlow,
    PhoneView,
    HistorySheet
  },
  data () {
    return {
      showAddForm: false,
      showScan: false,
      showTalk: false,
      showHistory: false,
      missingKey: false,
      viewMode: 'wall',
      justAdded: '',
      pastedKey: '',
      // The code on the not-connected screen, and the listener behind it.
      pairingCode: '',
      cancelPairing: null,
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
      // Pantry stores are tracked but not shown — see the `displayTimers`
      // getter. The wall is for things that are about to go off.
      return this.$store.getters['fridge/displayTimers'];
    },
    allTimers () {
      return this.$store.getters['fridge/allTimers'];
    },
    loading () {
      return this.$store.state.fridge.loading;
    },
    error () {
      const error = this.$store.state.fridge.error;
      return error === 'unauthorized' || error === 'unknown' ? null : error;
    },
    pairingCodeSpaced () {
      return this.pairingCode ? `${this.pairingCode.slice(0, 3)} ${this.pairingCode.slice(3)}` : '';
    },
    // Signed in, no key in the URL, and the hat's pointer hasn't reported
    // yet. That is a moment to wait through, not a failure: the pointer is a
    // Firebase subscription and always lands AFTER mount on a cold load.
    awaitingHatKey () {
      return this.missingKey &&
        Boolean(this.$store.state.databaseTopKey) &&
        !this.$store.state.fridgeKeyLoaded;
    },
    notConnected () {
      const error = this.$store.state.fridge.error;
      return (this.missingKey && !this.awaitingHatKey) ||
        error === 'unauthorized' || error === 'unknown';
    },
    // Say which of the three it actually is. The old copy claimed "no key"
    // even when the key was present and the database had refused it, which
    // sent you looking for the wrong problem. "Unknown" is the typo case: a
    // well-formed key that names no fridge, which used to render as an empty
    // fridge and say nothing.
    notConnectedReason () {
      if (this.missingKey) return 'This device has no fridge key yet.';
      if (this.$store.state.fridge.error === 'unknown') {
        return 'No fridge has the key in this link — there is probably a typo in it.';
      }
      return 'The fridge key on this device was refused. It may have been replaced.';
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
    // The not-connected screen always offers a pairing code, and the listener
    // behind it lives exactly as long as the screen does.
    notConnected: {
      immediate: true,
      handler (shown) {
        if (shown) this.startPairing();
        else this.stopPairing();
      }
    },
    // The hat's pointer landing after mount is the NORMAL cold-load order.
    // connect() ran once already and found nothing; run it again now.
    '$store.state.fridgeKeyForHat' (key) {
      if (key && this.missingKey) this.connect();
    },
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
    this.viewMode = resolveViewMode();

    // THE BLACK PAGE IS THE WALL'S, AND ONLY THE WALL'S (2026-09-20).
    //
    // It used to go on for both. Perishable owned the whole screen and set it
    // on `body`; the merge kept that behind a class so it could be taken off
    // again, but left it applying to the phone too — which is why Matt said
    // the fridge "feels like it's a separate thing" from meal-hat. On a phone
    // it now looks like every other page in the app: Mulish, white, the
    // house header, Bootstrap buttons.
    //
    // The wall keeps its Roboto Serif on black exactly as it was. That is a
    // standing rule, and this is the change that makes the rule cheap to keep:
    // the two surfaces are now styled apart on purpose rather than by
    // accident.
    if (this.viewMode === 'wall') document.body.classList.add('fridge-active');

    this.connect();
  },
  beforeUnmount () {
    document.body.classList.remove('fridge-active');
    clearTimeout(this.justAddedTimer);
    this.stopPairing();
  },
  methods: {
    // Two doors to the same fridge. The kiosk arrives holding the key in its
    // URL; a signed-in phone has no key in the address bar and looks up the
    // hat's pointer instead, so the secret never has to be pasted onto a
    // device that is already authenticated.
    connect () {
      const fromUrl = adoptFridgeKey();
      const key = fromUrl || this.$store.state.fridgeKeyForHat;
      if (key) {
        // A key from the address bar or storage was typed by someone at some
        // point, so it is verified; the hat's own pointer is not.
        this.$store.dispatch('fridge/subscribe', { key, verify: Boolean(fromUrl) });
        this.missingKey = false;
      } else {
        this.missingKey = true;
      }
    },
    async startPairing () {
      if (this.cancelPairing) return;
      const code = generatePairingCode();
      this.pairingCode = code;
      const { promise, cancel } = await this.$store.dispatch('fridge/awaitPairing', code);
      this.cancelPairing = cancel;
      promise.then((key) => {
        if (this.cancelPairing !== cancel) return; // superseded or unmounted
        this.cancelPairing = null;
        this.pairingCode = '';
        this.adoptKey(key);
      });
    },
    stopPairing () {
      if (this.cancelPairing) this.cancelPairing();
      this.cancelPairing = null;
      this.pairingCode = '';
    },
    // A full reload rather than re-dispatching: it re-runs adoptFridgeKey,
    // which puts the key in the address bar, and clears any half-built state
    // from the failed attempt. The hash and the wall's view pin are carried
    // explicitly — assigning to location.search alone would drop the route.
    adoptKey (key) {
      // If the address bar holds a different well-formed key — the typo this
      // pairing is correcting — remember the mapping, so the kiosk's saved
      // start URL keeps working after a restart instead of asking again.
      const fromUrl = new URLSearchParams(window.location.search).get('k');
      if (isValidKey(fromUrl) && fromUrl !== key) rememberKeyAlias(fromUrl, key);
      storeFridgeKey(key);
      window.location.href = urlWithKey(key, window.location);
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
      this.adoptKey(key);
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
    // The talk flow does its own writing (fridge/applyTalk), because it is one
    // agreed plan rather than a pile of separate decisions. This only reports.
    onTalkApplied ({ added, removed }) {
      const parts = [];
      if (added) parts.push(`Added ${added}`);
      if (removed) parts.push(`removed ${removed}`);
      if (parts.length) this.noteAdded(parts.join(', '));
    },
    // The scan applies itself the moment it lands — there is no confirm step
    // any more — so this just writes what it was handed and leaves the sheet
    // open on its report.
    async confirmScan ({ timers, templates }) {
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
@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&family=Roboto+Serif:ital,opsz,wght@0,8..144,100..900;1,8..144,100..900&display=swap");

body.fridge-active {
  font-family: "Roboto Serif", serif;
  background: #000;
  color: #fff;
}

/* Perishable's global reset, confined to the fridge. Bootstrap's reboot still
 * owns every other screen.
 *
 * SPECIFICITY IS THE WHOLE POINT of this selector. Perishable's reset was a
 * bare `*` — specificity zero — so every component's own `.timer-card`
 * padding beat it. The first port nested this under `body.fridge-active`,
 * which made it (0,2,1): heavier than any scoped component rule, so it
 * stripped the padding and margins off every card, and the wall came up
 * squashed the first time it was seen in meal-hat (2026-09-11). `:where()`
 * contributes nothing, leaving (0,1,0) from `.fridge-app`: enough to beat
 * Bootstrap's element-level reboot (`p`, `h1`, `button`…), and less than any
 * scoped rule, which carries a class plus a data attribute. */
:where(body.fridge-active) .fridge-app * {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* ONE SET OF TOKENS, TWO SURFACES.
 *
 * The sheets (add by hand, the talk-through, the receipt scan, the change log)
 * are shared: the wall opens the first two and the phone opens all four. They
 * used to hard-code Perishable's dark palette, which is why bringing the phone
 * into meal-hat's design would otherwise have meant forking every one of them.
 *
 * So the colours are named here and redefined per surface. A sheet says
 * `var(--fr-surface)` and comes out black on the wall and white on the phone
 * with no knowledge of which it is in. The wall's values reproduce exactly
 * what it looked like before — that is the point of writing them down. */
.fridge-app {
  --fr-bg: #000;
  --fr-surface: #1a1a1a;
  --fr-text: #fff;
  --fr-muted: rgba(255, 255, 255, 0.6);
  --fr-faint: rgba(255, 255, 255, 0.4);
  --fr-line: rgba(255, 255, 255, 0.12);
  --fr-field: rgba(255, 255, 255, 0.07);
  --fr-accent: #4caf50;
  --fr-danger: #ffab91;
  --fr-warn: #ffcc80;
  /* Behind a sheet. Dark over the wall's black; lighter over a white page, or
     the sheet has no edge at all. */
  --fr-scrim: rgba(0, 0, 0, 0.8);
  --fr-font: "Roboto Serif", serif;
  --fr-mono: "IBM Plex Mono", monospace;

  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  padding: 16px;
  /* Set here and not only on body: meal-hat's #app puts Mulish on everything
   * beneath it, and inheritance walks through #app before it reaches the
   * fridge. Perishable's wall is Roboto Serif and stays that way. */
  font-family: var(--fr-font);

  /* The phone is a meal-hat page. Same palette as every other screen: Mulish,
     the house green, Bootstrap's body colour on white. */
  &.phone {
    --fr-bg: #fff;
    --fr-surface: #fff;
    --fr-text: #212529;
    --fr-muted: #6c757d;
    --fr-faint: #adb5bd;
    --fr-line: #dee2e6;
    --fr-field: #f8f9fa;
    --fr-accent: #408558;
    --fr-danger: #f8333c;
    --fr-warn: #b06a00;
    --fr-scrim: rgba(33, 37, 41, 0.5);
    --fr-font: "Mulish", sans-serif;

    min-height: auto;
    padding: 0;
    background: #fff;
    color: var(--fr-text);
  }

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
    /* See the dvh note on the sheets: 100vh is the large viewport on iOS. */
    height: 100vh;
    height: 100dvh;
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
    height: 100dvh;
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
        font-family: "IBM Plex Mono", monospace;
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
        font-family: "IBM Plex Mono", monospace;
      }
    }

    .pair {
      margin-top: 3rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }

    .pair-label {
      font-size: 1.25rem;
      opacity: 0.7;
    }

    // Readable from across the kitchen while holding a phone.
    .pair-code {
      font-family: "IBM Plex Mono", monospace;
      font-size: 4.5rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: #fff;
    }

    .pair-hint {
      font-size: 1.1rem;
      opacity: 0.6;
      max-width: 28rem;
    }
  }

  /* The phone's sheets (add by hand, scan, what's changed). Bug report,
   * 2026-09-11: "Everything looks really weird and cramped along the
   * edges." Each sheet was a 90vw box centred in the viewport with 2rem of
   * padding: on a 402px phone that left 297px for content, and the add-by-
   * hand box, which had no height cap, was taller than the screen and got
   * centred right off the top of it — its header and close button out of
   * reach. Below the wall's width (viewMode.js: 900px) every sheet is a
   * bottom sheet instead: full width, its own scroll, room at the bottom for
   * the home indicator. (0,3,0) on purpose: heavier than the components'
   * own scoped (0,2,0) rules, so this wins without touching them — and the
   * wall, above 900px, never sees any of it. */
  @media (max-width: 899px) {
    .modal-overlay {
      align-items: flex-end;
    }

    .modal-overlay .modal-content {
      width: 100%;
      max-width: none;
      /* Bootstrap's reboot gives a .modal-content a margin; a sheet sits
         flush with the edges and the bottom of the screen. */
      margin: 0;
      max-height: 92vh;
      max-height: 92dvh;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      border-radius: 20px 20px 0 0;
      border-width: 1px 0 0;
      padding: 1.25rem 1.25rem calc(1.5rem + env(safe-area-inset-bottom));
    }

    .modal-overlay .modal-header {
      margin-bottom: 1.25rem;
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
  //
  // CALLED `wall-stamp`, NOT `build-stamp`, and that rename is a bug fix.
  //
  // These styles are deliberately unscoped and nested under `.fridge-app`. The
  // moment the house `Header` moved INSIDE the fridge (2026-09-20), this rule
  // started capturing the header's OWN `.build-stamp` — and the two together
  // set all four offsets on a fixed element: `top: 1px` from the header,
  // `bottom: -4px` from here, `left: 0` from here, `right: 3px` from there. A
  // fixed box with all four offsets STRETCHES, so the header's stamp became an
  // invisible full-viewport overlay that swallowed every tap on the page. What
  // Matt saw was the logo refusing to go home: his tap was landing on a stamp
  // covering the whole screen, and tapping the stamp reloads the app.
  //
  // The lesson is bigger than the fix: an unscoped rule nested under a layout
  // class captures anything that layout ever comes to contain. Class names
  // used here must not be ones the rest of the app uses.
  .wall-stamp {
    position: fixed;
    bottom: -4px;
    left: 0;
    padding: 8px;
    font-size: 10px;
    opacity: 0.35;
    font-family: "IBM Plex Mono", monospace;
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
