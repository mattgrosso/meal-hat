<template>
  <div class="add-timer-button" @click="$emit('add-timer')">
    <div class="plus-icon">+</div>
    <div class="add-text">Add Timer</div>
  </div>
</template>

<script>
export default {
  name: 'AddTimerButton'
}
</script>

<style lang="scss" scoped>
.add-timer-button {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 2px dashed rgba(255, 255, 255, 0.3);
  border-radius: 16px;
  padding: 2rem;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 195px;

  &:hover {
    border-color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.15);
    transform: scale(1.02);
  }

  &:active {
    transform: scale(0.98);
  }

  .plus-icon {
    font-size: 3rem;
    font-weight: 300;
    margin-bottom: 0.5rem;
    opacity: 0.7;
  }

  .add-text {
    font-size: 1.1rem;
    font-weight: 500;
    opacity: 0.8;
  }
}

@media (max-width: 480px) {
  .add-timer-button {
    height: 220px;
    padding: 1.5rem;

    .plus-icon {
      font-size: 2.5rem;
    }

    .add-text {
      font-size: 1rem;
    }
  }
}
</style>