<template>
  <button
    v-if="!isOpen"
    type="button"
    class="bug-report-trigger"
    title="Report a bug"
    aria-label="Report a bug"
    @click="open"
  >
    <i class="bi bi-bug-fill"></i>
  </button>

  <!-- Hand-rolled, deliberately NOT Bootstrap's Modal. This app has already
       lost a screen to it once (db1f953, "Fix shopping-list modal freezing the
       screen"), and a bug-report button that freezes the app would be a poor
       joke. No JS modal library, no backdrop element to leak, no data-api. -->
  <div v-if="isOpen" class="bug-report-backdrop" @click.self="close">
    <div class="bug-report-panel" role="dialog" aria-modal="true" aria-label="Report a bug">
      <template v-if="!sent">
        <h2 class="bug-report-panel__title">Report a bug</h2>
        <textarea
          ref="textarea"
          v-model="transcript"
          class="bug-report-panel__textarea"
          placeholder="What happened?"
          rows="5"
          :disabled="sending"
        ></textarea>
        <p v-if="error" class="bug-report-panel__error">{{ error }}</p>
        <div class="bug-report-panel__actions">
          <button type="button" class="btn btn-sm btn-secondary" :disabled="sending" @click="close">
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="sending || !transcript.trim()"
            @click="send"
          >
            {{ sending ? 'Sending…' : 'Send report' }}
          </button>
        </div>
      </template>

      <!-- Says something DIFFERENT when it only reached the stash. Reporting
           "Sent" for something still sitting in localStorage is a lie the user
           would have no way to catch. -->
      <p v-else-if="queuedOffline" class="bug-report-panel__sent">
        <i class="bi bi-check-circle-fill"></i> Saved — it&rsquo;ll send when you&rsquo;re back online.
      </p>
      <p v-else class="bug-report-panel__sent">
        <i class="bi bi-check-circle-fill"></i> Sent — thanks!
      </p>
    </div>
  </div>
</template>

<script>
import { submitBugReport } from '@/utils/bugReports';

export default {
  name: 'BugReportButton',
  data () {
    return {
      isOpen: false,
      transcript: '',
      sending: false,
      error: null,
      sent: false,
      queuedOffline: false
    };
  },
  methods: {
    open () {
      this.isOpen = true;
      this.sent = false;
      this.error = null;
      this.$nextTick(() => this.$refs.textarea?.focus());
    },
    close () {
      // Never disappear mid-send: the text is the only copy until the write
      // lands or the stash catches it.
      if (this.sending) return;
      this.isOpen = false;
      this.transcript = '';
      this.error = null;
    },
    async send () {
      if (!this.transcript.trim() || this.sending) return;

      this.sending = true;
      this.error = null;

      try {
        const result = await submitBugReport(this.$store, this.transcript, this.$route);
        this.sent = true;
        this.queuedOffline = Boolean(result && result.queued);
        this.transcript = '';
        setTimeout(() => {
          this.isOpen = false;
          this.sent = false;
          this.queuedOffline = false;
        }, 2200);
      } catch (err) {
        // Keep the text. They just typed it and it is not stored anywhere else.
        this.error = err.message || 'Could not send that report.';
      } finally {
        this.sending = false;
      }
    }
  }
};
</script>

<style lang="scss" scoped>
/* Fixed bottom-LEFT, matching Cinema Roll — which moved it there from the right
   after a report. Clear of this app's fixed furniture: the header is at the top
   and the "?" tour button sits bottom-RIGHT, so the two never collide.

   Sized as an always-visible tap target well above the 40px minimum, with an
   :active press state and no :hover — this is an installed PWA, and on iOS a
   tapped element keeps a hover state with no pointer to leave it. Respects the
   safe-area inset so it clears the home indicator on notched phones. */
.bug-report-trigger {
  position: fixed;
  left: 1rem;
  bottom: calc(1rem + env(safe-area-inset-bottom, 0));
  z-index: 1200;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 50%;
  border: 1px solid #c9c9c9;
  background: #fff;
  color: #5a5a5a;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  opacity: 0.85;
  padding: 0;
}

.bug-report-trigger:active {
  opacity: 1;
  border-color: #408558;
  color: #408558;
}

.bug-report-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.bug-report-panel {
  background: #fff;
  border: 1px solid #dcdcdc;
  border-radius: 0.5rem;
  padding: 1.25rem;
  max-width: min(420px, 90vw);
  width: 100%;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.bug-report-panel__title {
  font-size: 1.05rem;
  margin: 0;
}

.bug-report-panel__textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid #ced4da;
  border-radius: 0.375rem;
  padding: 0.5rem;
  font: inherit;
  /* A UA-imposed minimum width beats width: 100% and can push the panel wider
     than the viewport on a phone. */
  min-width: 0;
}

/* #b02a37, not Bootstrap's .text-danger — this needs to read against white. */
.bug-report-panel__error {
  color: #b02a37;
  font-size: 0.9rem;
  margin: 0;
}

.bug-report-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.bug-report-panel__sent {
  text-align: center;
  margin: 0.5rem 0;
  color: #2f6f47;
}
</style>
