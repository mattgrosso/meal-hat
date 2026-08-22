<template>
  <div class="meal-hat">
    <router-view @showToast="showToast"></router-view>
    <BugReportButton/>
    <div class="toast" role="alert" aria-live="assertive" aria-atomic="true" id="myToast">
      <div class="toast-body">
        {{toastMessage}}
      </div>
    </div>
  </div>
</template>

<script>
import { Toast } from 'bootstrap';
import BugReportButton from '@/components/BugReportButton.vue';
import { flushStashedBugReports } from '@/utils/bugReports.js';
import {
  entryBundleFromHtml,
  entryBundleFromScripts,
  isSafeMomentForReload,
  reloadForUpdate,
  shouldAutoAttempt
} from '@/utils/appUpdate.js';

// How long after opening or foregrounding the app still counts as a "fresh
// moment" — nothing is in flight yet, so an update can simply be applied.
const FRESH_MOMENT_MS = 5000;

// How long the user has to have done nothing before a reload counts as
// unnoticeable, once the fresh moment has passed.
const QUIET_STRETCH_MS = 25000;

// How often we re-check whether that quiet stretch has arrived.
const QUIET_POLL_MS = 5000;

// Backstop check, for an installed PWA left open and foregrounded for hours
// with no lifecycle event ever firing.
const PERIODIC_CHECK_MS = 30 * 60 * 1000;

export default {
  name: 'MealHat',
  components: {
    BugReportButton
  },
  data () {
    return {
      toastMessage: "",
      lastActivityAt: Date.now(),
      lastBecameVisibleAt: Date.now(),
      deployedBundleSeen: null,
      autoUpdateTimer: null
    }
  },
  watch: {
    // Apply an update the moment it is spotted at a fresh moment (just opened
    // or just foregrounded — nothing is in progress), otherwise after ~25s of
    // no interaction, and never while typing, in a modal, mid-tour, or with a
    // screen holding something only memory knows about.
    '$store.state.updateAvailable' (available) {
      if (!available) return;
      this.armAutoUpdate();
    }
  },
  async mounted () {
    // Drain anything filed while offline. Fire-and-forget: a failure here just
    // leaves the stash for the next launch, and must never block startup.
    flushStashedBugReports().catch(() => {});

    // visibilitychange alone is unreliable on iOS, particularly for a
    // home-screen-installed PWA — it is a long-standing WebKit quirk that it
    // sometimes just does not fire when the app is brought back to the
    // foreground. pageshow and window focus are more consistent there, and the
    // interval is a backstop that depends on no lifecycle event at all.
    // Between the four, an update gets picked up even if any single trigger
    // never fires. This app lives on a home screen; that is not theoretical.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.lastBecameVisibleAt = Date.now();
        this.checkForUpdate();
      }
    });
    window.addEventListener('pageshow', () => {
      this.lastBecameVisibleAt = Date.now();
      this.checkForUpdate();
    });
    window.addEventListener('focus', this.checkForUpdate);

    // Activity signals for the quiet-moment detector. Passive: these must
    // never delay a scroll on a phone.
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((eventName) => {
      window.addEventListener(eventName, this.noteActivity, { passive: true });
    });

    setInterval(this.checkForUpdate, PERIODIC_CHECK_MS);
  },
  methods: {
    noteActivity () {
      this.lastActivityAt = Date.now();
    },
    async checkForUpdate () {
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration) {
            await registration.update();
          }
        } catch {
          // Best-effort — a failed check just means the next trigger tries
          // again, rather than blocking anything the user is doing.
        }
      }

      await this.checkDeployedBundle();
    },
    /**
     * Notices a new deploy by comparing bundle filenames, independent of any
     * service worker state.
     *
     * The service worker's `updated()` hook only fires while a new worker sits
     * in the `installed` state — but this app builds with `skipWaiting: true`
     * (vue.config.js, load-bearing against the 2026-08-19 reload loop), so a
     * new worker activates itself immediately instead of waiting. That makes
     * the hook a race the app often loses: you get the new version, you just
     * do not get told. Comparing what the server serves against what this page
     * actually loaded does not depend on that timing at all.
     *
     * The cache-busting param matters: the `meal-hat-pages` runtime cache is
     * NetworkFirst on navigations, and this is not a navigation — a unique
     * query plus `no-store` is what guarantees a fresh read of index.html
     * rather than whatever a cache decides to answer with.
     */
    async checkDeployedBundle () {
      if (this.$store.state.updateAvailable) {
        return;
      }

      const runningBundle = this.currentBundleName();
      if (!runningBundle) {
        return;
      }

      try {
        const response = await fetch(`${process.env.BASE_URL || '/'}index.html?updateCheck=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) {
          return;
        }
        const deployedBundle = entryBundleFromHtml(await response.text());
        if (deployedBundle && deployedBundle !== runningBundle) {
          this.deployedBundleSeen = deployedBundle;
          this.$store.commit('setUpdateAvailable', true);
        }
      } catch {
        // Offline, blocked, or the check simply failed — try again next time.
      }
    },
    /** The app bundle THIS page is running, read off its own script tags. */
    currentBundleName () {
      return entryBundleFromScripts(
        Array.from(document.querySelectorAll('script[src]'))
          .map((script) => script.getAttribute('src'))
      );
    },
    armAutoUpdate () {
      const target = this.deployedBundleSeen || 'unknown';
      if (!shouldAutoAttempt(target)) return; // once per version, never a loop

      // Fresh moment (just opened or just foregrounded): nothing is in flight
      // yet — apply right away.
      const fresh = Date.now() - (this.lastBecameVisibleAt || 0) < FRESH_MOMENT_MS;
      if (fresh && isSafeMomentForReload()) {
        reloadForUpdate();
        return;
      }

      // Otherwise: wait for a quiet stretch. The timer keeps running until one
      // arrives, so an app parked on a screen that is never safe simply
      // updates the moment the user leaves it.
      if (this.autoUpdateTimer) clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = setInterval(() => {
        const quiet = Date.now() - this.lastActivityAt > QUIET_STRETCH_MS;
        if (quiet && isSafeMomentForReload()) {
          clearInterval(this.autoUpdateTimer);
          this.autoUpdateTimer = null;
          reloadForUpdate();
        }
      }, QUIET_POLL_MS);
    },
    showToast (config) {
      this.toastMessage = config.message;
      const toastEl = document.getElementById('myToast');
      const toast = new Toast(toastEl, {
        autohide: true,
        delay: config.delay || 5000
      });
      toast.show();

      setTimeout(() => {
        this.toastMessage = "";
      }, config.delay + 100 || 5100);
    },
  },
}
</script>

<style lang="scss">
body {
  touch-action: manipulation;
}

#app {
  font-family: "Mulish", sans-serif;

  .btn-primary {
    background: #408558;
    border-color: #408558;
  }

  .btn-secondary {
    background: #274C77;
    border-color: #274C77;
  }

  .btn-tertiary {
    background: #91C4F2;
    border-color: #91C4F2;
  }

  .btn-success {
    background: #FE7F2D;
    border-color: #FE7F2D;
    color: white;
  }

  .btn-warning {
    background: #F8333C;
    border-color: #F8333C;
    color: white;
  }

  .toast.show {
    position: absolute;
    top: 16px;
    width: 80%;
    left: 50%;
    transform: translateX(-50%);
  }
}

.start-tour-button {
  cursor: pointer;
  font-size: 1.5rem;
  height: 40px;
  position: fixed;
  right: 12px;
  width: 40px;
  bottom: 12px;
}

.shepherd-element.shepherd-has-title {
  margin-top: 15px;

  &[data-popper-placement^="top"] {
    margin-top: -15px;

    .shepherd-arrow::before {
      background-color: white !important;
    }
  }

  .shepherd-arrow::before {
    background-color: #274C77 !important;
  }

  .shepherd-content {
    .shepherd-header {
      align-items: center;
      background: #274C77;
      display: flex;
      padding: 12px;

      .shepherd-title {
        align-items: center;
        color: white;
        display: flex;
        font-size: 1.2rem;
        width: 75%;
      }

      .shepherd-cancel-icon {
        align-items: center;
        color: white;
        display: flex;
        height: 20px;
        justify-content: center;
        width: 20px;

        span {
          align-items: center;
          display: flex;
          font-size: 25px;
          height: 18px;
          justify-content: center;
          position: relative;
          top: -1px;
          width: 18px;
        }
      }
    }

    .shepherd-text {
      font-size: 0.9rem;
    }

    .shepherd-footer {
      padding: 6px;
    }
  }
}
</style>
