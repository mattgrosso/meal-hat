<template>
  <div class="timer-card" :class="timerStatus" @dblclick="handleDoubleClick" @touchstart="handleTouchStart" @touchend="handleTouchEnd">
    <div class="timer-header" :class="{'edit-mode-header': editMode}">
      <h2 class="timer-title">{{ timer.title }}</h2>
      <button class="remove-btn" @click="$emit('remove', timer.id)">×</button>
    </div>

    <!-- Edit Mode UI -->
    <div v-if="editMode" class="edit-mode">
      <div class="adjustment-display">
        <div class="current-time">Current time: {{ formatCurrentTime() }}</div>
        <div class="new-time">New time: {{ formatNewTime() }}</div>
      </div>

      <div class="edit-controls">
        <button class="adjust-btn" @click="addTime(1)">+1 Day</button>
        <button class="adjust-btn" @click="addTime(7)">+1 Week</button>
      </div>

      <div class="edit-actions">
        <button class="cancel-btn" @click="cancelEdit">Cancel</button>
        <button class="save-btn" @click="saveAdjustment" :disabled="pendingAdjustment === 0">
          Save {{ pendingAdjustment > 0 ? `(+${formatAdjustment(pendingAdjustment)})` : '' }}
        </button>
      </div>
    </div>

    <!-- Normal Display -->
    <div v-else class="countdown-display">
      <div class="time-part" v-if="timeLeft.days > 0">
        <span class="number">{{ String(timeLeft.days).padStart(2, '0') }}</span>
        <span class="label">{{ timeLeft.days === 1 ? 'day' : 'days' }}</span>
      </div>
      <div class="time-part">
        <span class="number">{{ String(timeLeft.hours).padStart(2, '0') }}</span>
        <span class="label">hr</span>
      </div>
      <div class="time-part">
        <span class="number">{{ String(timeLeft.minutes).padStart(2, '0') }}</span>
        <span class="label">min</span>
      </div>
      <div class="time-part">
        <span class="number">{{ String(timeLeft.seconds).padStart(2, '0') }}</span>
        <span class="label">sec</span>
      </div>
    </div>
  </div>
</template>

<script>
import { computeTimeLeft, timerStatus, extendedExpiry, templateDaysAfterEdit, formatDaySpan } from '@/store/fridge/timers'

export default {
  name: 'CountdownTimer',
  props: {
    timer: {
      type: Object,
      required: true
    }
  },
  data () {
    return {
      now: new Date(),
      interval: null,
      editMode: false,
      pendingAdjustment: 0,
      lastTouchTime: 0,
      touchCount: 0,
      touchStartPos: null
    }
  },
  computed: {
    timeLeft () {
      return computeTimeLeft(this.timer.expiryDate, this.now)
    },
    timerStatus () {
      return timerStatus(this.timeLeft)
    }
  },
  mounted () {
    this.startTimer()
  },
  beforeUnmount () {
    this.stopTimer()
  },
  methods: {
    startTimer () {
      this.interval = setInterval(() => {
        this.now = new Date()
      }, 1000)
    },
    stopTimer () {
      if (this.interval) {
        clearInterval(this.interval)
      }
    },
    openEditMode () {
      if (!this.editMode) {
        this.editMode = true
      }
    },
    handleDoubleClick (event) {
      event.preventDefault()
      this.openEditMode()
    },
    handleTouchStart (event) {
      const touch = event.touches[0]
      this.touchStartPos = { x: touch.clientX, y: touch.clientY }

      const now = Date.now()
      const timeSinceLastTouch = now - this.lastTouchTime

      if (timeSinceLastTouch < 500 && timeSinceLastTouch > 50) {
        this.touchCount++
        if (this.touchCount === 2) {
          event.preventDefault()
          this.openEditMode()
          this.touchCount = 0
          return
        }
      } else {
        this.touchCount = 1
      }

      this.lastTouchTime = now
    },
    handleTouchEnd (event) {
      if (!this.touchStartPos) return

      const touch = event.changedTouches[0]
      const deltaX = Math.abs(touch.clientX - this.touchStartPos.x)
      const deltaY = Math.abs(touch.clientY - this.touchStartPos.y)

      if (deltaX > 10 || deltaY > 10) {
        this.touchCount = 0
        return
      }

      setTimeout(() => {
        if (this.touchCount === 1) {
          this.touchCount = 0
        }
      }, 500)
    },
    addTime (days) {
      this.pendingAdjustment += days
    },
    formatCurrentTime () {
      return formatDaySpan(this.timeLeft.days + (this.timeLeft.hours / 24))
    },
    formatAdjustment (days) {
      return formatDaySpan(days)
    },
    formatNewTime () {
      return formatDaySpan(this.timeLeft.days + (this.timeLeft.hours / 24) + this.pendingAdjustment)
    },
    cancelEdit () {
      this.editMode = false
      this.pendingAdjustment = 0
    },
    async saveAdjustment () {
      if (this.pendingAdjustment === 0) return

      // An expired timer extends from now, not from its long-dead expiry —
      // see extendedExpiry in lib/timers.js.
      const newExpiryIso = extendedExpiry(this.timer.expiryDate, this.pendingAdjustment, new Date())

      const updatedTimer = {
        ...this.timer,
        expiryDate: newExpiryIso
      }

      try {
        await this.$store.dispatch('fridge/updateTimer', {
          id: this.timer.id,
          timer: updatedTimer,
          source: 'edit',
          addedDays: this.pendingAdjustment
        })

        // The template relearns its duration from the timer's actual new lifespan
        await this.$store.dispatch('fridge/saveTemplate', {
          title: this.timer.title,
          days: templateDaysAfterEdit(newExpiryIso, this.timer.createdAt),
          source: 'edit'
        })

        this.editMode = false
        this.pendingAdjustment = 0
      } catch (error) {
        console.error('Failed to update timer:', error)
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.timer-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 16px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  transition: all 0.3s ease;
  height: 195px;

  &.good {
    border-color: rgba(72, 187, 120, 0.5);
    background: rgba(72, 187, 120, 0.1);
  }

  &.caution {
    border-color: rgba(237, 137, 54, 0.5);
    background: rgba(237, 137, 54, 0.1);
  }

  &.warning {
    border-color: rgba(245, 101, 101, 0.5);
    background: rgba(245, 101, 101, 0.1);
  }

  &.expired {
    border-color: rgba(245, 101, 101, 0.8);
    background: rgba(245, 101, 101, 0.2);
    animation: pulse 2s infinite;
  }
}

.timer-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;

  &.edit-mode-header {
    margin-bottom: 0;

    .timer-title {
      font-size: 1rem;
    }

    .remove-btn {
      display: none;
    }
  }

  .timer-title {
    font-size: 1.8rem;
    font-weight: 400;
    flex: 1;
    margin-right: 1rem;
    transition: font-size 0.2s ease;
  }

  .remove-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    color: #fff;
    font-size: 1.5rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;

    &:hover {
      background: rgba(245, 101, 101, 0.8);
    }
  }
}

.countdown-display {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;

  .time-part {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 50px;

    .number {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 48px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }

    .label {
      font-size: 12px;
      opacity: 0.7;
      margin-top: 8px;
      letter-spacing: 0.5px;
    }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.edit-mode {
  height: calc(100% - 3rem);
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
  padding: 0.25rem 0;
  margin-top: 0.5rem;

  .adjustment-display {
    text-align: center;
    font-size: 0.7rem;
    line-height: 1.1;

    .current-time {
      color: rgba(255, 255, 255, 0.8);
      margin-bottom: 0.5rem;
    }

    .new-time {
      color: #fff;
      font-weight: 600;
      font-size: 0.8rem;
      margin-bottom: 0.5rem;
    }
  }

  .edit-controls {
    display: flex;
    gap: 0.4rem;
    justify-content: center;
    margin-bottom: 0.5rem;

    .adjust-btn {
      padding: 0.4rem 0.6rem;
      background: rgba(76, 175, 80, 0.2);
      border: 1px solid rgba(76, 175, 80, 0.4);
      border-radius: 4px;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.7rem;

      &:hover {
        background: rgba(76, 175, 80, 0.3);
        border-color: rgba(76, 175, 80, 0.6);
      }

      &:active {
        transform: scale(0.98);
      }
    }
  }

  .edit-actions {
    display: flex;
    gap: 0.4rem;
    justify-content: center;

    .cancel-btn, .save-btn {
      padding: 0.4rem 0.8rem;
      border: none;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.7rem;
    }

    .cancel-btn {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.3);

      &:hover {
        background: rgba(255, 255, 255, 0.2);
        border-color: rgba(255, 255, 255, 0.5);
      }
    }

    .save-btn {
      background: #4CAF50;
      color: white;

      &:hover:not(:disabled) {
        background: #45a049;
      }

      &:active:not(:disabled) {
        transform: scale(0.98);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
}

@media (max-width: 480px) {
  .timer-card {
    padding: 1.5rem;
  }

  .countdown-display {
    gap: 0.5rem;

    .time-part .number {
      font-size: 1.8rem;
    }
  }

  .edit-mode {
    height: calc(100% - 2.5rem);
    margin-top: 0.25rem;

    .adjustment-display {
      font-size: 0.6rem;

      .new-time {
        font-size: 0.7rem;
      }
    }

    .edit-controls {
      gap: 0.3rem;

      .adjust-btn {
        padding: 0.3rem 0.5rem;
        font-size: 0.6rem;
      }
    }

    .edit-actions {
      gap: 0.3rem;

      .cancel-btn, .save-btn {
        padding: 0.3rem 0.6rem;
        font-size: 0.6rem;
      }
    }
  }
}
</style>