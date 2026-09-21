<template>
  <!-- "A bug you reported is fixed" - the reply half of the bug button, ported
       from Cinema Roll (2026-09-21). Shown once per notice, on the launch
       after `yarn resolve-bug-report` wrote it; any dismissal marks every
       notice on screen as seen. The point is "your report mattered, here's
       what happened", not a task to acknowledge. -->
  <div v-if="notices.length" class="bug-resolution-backdrop" @click.self="dismiss">
    <div class="bug-resolution-panel" role="dialog" aria-label="A bug you reported was fixed">
      <h2>{{ notices.length === 1 ? 'A bug you reported is fixed' : 'Bugs you reported are fixed' }}</h2>
      <p class="bug-resolution-panel__thanks">Thanks for telling us &mdash; here&rsquo;s what happened.</p>
      <div v-for="notice in notices" :key="notice.id" class="bug-resolution-notice">
        <p v-if="notice.reportSnippet" class="bug-resolution-notice__quote">You said: &ldquo;{{ notice.reportSnippet }}&rdquo;</p>
        <p v-if="notice.understood" class="bug-resolution-notice__section">
          <span class="bug-resolution-notice__label">What was going wrong</span>{{ notice.understood }}
        </p>
        <p v-if="notice.fixed" class="bug-resolution-notice__section">
          <span class="bug-resolution-notice__label">What we did about it</span>{{ notice.fixed }}
        </p>
        <p v-if="notice.resolvedAt" class="bug-resolution-notice__date">Fixed {{ formatDate(notice.resolvedAt) }}</p>
      </div>
      <div class="bug-resolution-panel__actions">
        <button type="button" class="btn btn-sm btn-warning" @click="dismiss">Got it, thanks</button>
      </div>
    </div>
  </div>
</template>

<script>
import { fetchUnseenResolutions, markResolutionsSeen } from '../utils/bugResolutions.js';

export default {
  name: 'BugResolutionNotice',
  data () {
    return { notices: [], checkedFor: null };
  },
  computed: {
    // Notices are keyed by email; the store learns it once sign-in resolves.
    readyEmail () {
      return this.$store.state.userEmail || null;
    }
  },
  watch: {
    readyEmail: {
      immediate: true,
      async handler (email) {
        if (!email || this.checkedFor === email) return;
        this.checkedFor = email;
        this.notices = await fetchUnseenResolutions();
      }
    }
  },
  methods: {
    dismiss () {
      const ids = this.notices.map((notice) => notice.id);
      this.notices = [];
      markResolutionsSeen(ids);
    },
    formatDate (timestamp) {
      return new Date(timestamp).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    }
  }
};
</script>

<style scoped>
/* Neutral dark dress: the app talking about itself. :active only, no :hover. */
.bug-resolution-backdrop {
  position: fixed;
 inset: 0;
 z-index: 1150;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
 align-items: center;
 justify-content: center;
 padding: 1rem;
}

.bug-resolution-panel {
  width: 100%;
 max-width: min(440px, 90vw);
 max-height: 85vh;
 overflow-y: auto;
  border-radius: 0.6rem;
 background: #1a1a1a;
 border: 1px solid #444;
  color: #eee;
 padding: 1.25rem 1.5rem;
  display: flex;
 flex-direction: column;
 gap: 0.75rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
}
.bug-resolution-panel h2 { margin: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 0.5rem; }
.bug-resolution-panel h2::before { content: ""; width: 0.7rem; height: 0.7rem; border-radius: 50%; background: #7ac97a; flex: 0 0 auto; }
.bug-resolution-panel__thanks { margin: 0; font-size: 0.9rem; color: #ccc; }

.bug-resolution-notice {
  border-radius: 0.4rem;
 background: #0d0d0d;
 border: 1px solid #2e2e2e;
  padding: 0.75rem 0.9rem;
 display: flex;
 flex-direction: column;
 gap: 0.5rem;
}
.bug-resolution-notice p { margin: 0; }
.bug-resolution-notice__quote { font-style: italic; font-size: 0.9rem; color: #ccc; }
.bug-resolution-notice__section { font-size: 0.95rem; }
.bug-resolution-notice__label { display: block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #ccc; margin-bottom: 0.15rem; }
.bug-resolution-notice__date { font-size: 0.75rem; color: #ccc; }
.bug-resolution-panel__actions { display: flex; justify-content: flex-end; }
.bug-resolution-panel__actions .btn { min-height: 40px; }
</style>
