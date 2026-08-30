<template>
  <div class="phone-view">
    <header class="phone-header">
      <h1>Perishable</h1>
      <p class="phone-sub">Groceries, a receipt, or the fridge.</p>
    </header>

    <button class="scan-cta" @click="$emit('scan')">
      <span class="scan-icon">📷</span>
      <span class="scan-label">Scan groceries</span>
    </button>

    <button class="manual-cta" @click="$emit('add')">
      Add one by hand
    </button>

    <button class="manual-cta" @click="$emit('history')">
      What's changed
    </button>

    <p v-if="justAdded" class="just-added">
      {{ justAdded }} — it's on the kitchen screen now.
    </p>
  </div>
</template>

<script>
// The phone. A capture surface, not a display — see lib/viewMode.js.
export default {
  name: 'PhoneView',
  props: {
    justAdded: { type: String, default: '' }
  },
  emits: ['scan', 'add', 'history']
}
</script>

<style lang="scss" scoped>
.phone-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding: 1.5rem;
  text-align: center;
}

.phone-header {
  margin-bottom: 0.5rem;

  h1 {
    font-size: 2.25rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .phone-sub {
    margin-top: 0.4rem;
    color: rgba(255, 255, 255, 0.55);
    font-size: 1rem;
  }
}

.scan-cta {
  width: 100%;
  max-width: 340px;
  // Big enough to hit one-handed while holding a shopping bag.
  padding: 2.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  background: rgba(72, 187, 120, 0.12);
  border: 2px solid rgba(72, 187, 120, 0.55);
  border-radius: 20px;
  color: #fff;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.2s ease;

  &:active {
    transform: scale(0.98);
    background: rgba(72, 187, 120, 0.2);
  }

  .scan-icon {
    font-size: 3rem;
    line-height: 1;
  }

  .scan-label {
    font-size: 1.4rem;
    font-weight: 600;
  }
}

.manual-cta {
  width: 100%;
  max-width: 340px;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.85);
  font-family: inherit;
  font-size: 1rem;
  cursor: pointer;

  &:active {
    background: rgba(255, 255, 255, 0.15);
  }
}

.just-added {
  color: #4CAF50;
  font-size: 1rem;
  max-width: 340px;
}
</style>
