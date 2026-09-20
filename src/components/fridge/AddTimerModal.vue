<template>
  <div class="modal-overlay" @click="closeModal">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>Add New Timer</h2>
        <button class="close-btn" @click="closeModal">×</button>
      </div>

      <!-- Quick Add Section -->
      <div v-if="savedTimerTemplates.length > 0" class="quick-add-section">
        <div class="quick-add-header">
          <h3>Quick Add</h3>
          <button
            type="button"
            @click="toggleEditMode"
            class="edit-btn"
            :class="{ active: editMode }"
            title="Edit templates"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="template-buttons">
          <div
            v-for="template in savedTimerTemplates"
            :key="template.title"
            class="template-item"
          >
            <button
              type="button"
              @click="editMode ? null : createFromTemplate(template)"
              class="template-btn"
              :class="{ disabled: editMode }"
            >
              <div class="template-name">{{ template.title }}</div>
              <div class="template-duration">{{ formatDuration(template.days) }}</div>
            </button>
            <button
              v-if="editMode"
              type="button"
              @click="removeTemplate(template.title)"
              class="remove-btn"
              title="Remove template"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="m18 6-12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="m6 6 12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="divider"></div>
      </div>

      <!-- Custom Timer Form -->
      <div class="custom-form-header">
        <h3>{{ savedTimerTemplates.length > 0 ? 'Create New' : 'Add Timer' }}</h3>
      </div>

      <form @submit.prevent="submitTimer" class="timer-form">
        <div class="form-group">
          <label for="title">Food Item</label>
          <input
            id="title"
            v-model="form.title"
            type="text"
            placeholder="e.g. Milk, Bread, Leftovers"
            required
            autofocus
          />
        </div>

        <div class="form-group">
          <label>Expires in:</label>
          <div class="expiry-buttons">
            <button
              type="button"
              :class="{ active: selectedDays === 5 }"
              @click="selectedDays = 5"
              class="expiry-btn"
            >
              5 days
            </button>
            <button
              type="button"
              :class="{ active: selectedDays === 7 }"
              @click="selectedDays = 7"
              class="expiry-btn"
            >
              1 week
            </button>
            <button
              type="button"
              :class="{ active: selectedDays === 10 }"
              @click="selectedDays = 10"
              class="expiry-btn"
            >
              10 days
            </button>
            <button
              type="button"
              :class="{ active: selectedDays === 14 }"
              @click="selectedDays = 14"
              class="expiry-btn"
            >
              2 weeks
            </button>
          </div>
        </div>

        <div class="form-actions">
          <button type="button" @click="closeModal" class="cancel-btn">Cancel</button>
          <button type="submit" class="add-btn" :disabled="!isValid">Add Timer</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AddTimerModal',
  data () {
    return {
      form: {
        title: ''
      },
      selectedDays: 7,
      editMode: false
    }
  },
  computed: {
    isValid () {
      return this.form.title.trim() && this.selectedDays
    },
    savedTimerTemplates () {
      return this.$store.getters['fridge/templates']
    }
  },
  methods: {
    closeModal () {
      this.$emit('close')
    },
    submitTimer () {
      if (!this.isValid) return

      const title = this.form.title.trim()
      const days = this.selectedDays
      const expiryDate = new Date()
      expiryDate.setDate(expiryDate.getDate() + days)

      this.$emit('add-timer', {
        title: title,
        expiryDate: expiryDate.toISOString()
      })

      // A number somebody typed on purpose, about this food rather than about
      // one item of it — so it both observes AND anchors. This is the one path
      // where a person is deliberately stating a shelf life.
      this.$store.dispatch('fridge/saveTemplate', {
        title: title,
        observed: days,
        anchor: days,
        source: 'hand'
      })

      this.form = { title: '' }
      this.selectedDays = 7
    },
    createFromTemplate (template) {
      const expiryDate = new Date()
      expiryDate.setDate(expiryDate.getDate() + template.days)

      this.$emit('add-timer', {
        title: template.title,
        expiryDate: expiryDate.toISOString()
      })

      this.closeModal()
    },
    formatDuration (days) {
      if (days === 7) return '1 week'
      if (days === 14) return '2 weeks'
      if (days === 1) return '1 day'
      return `${days} days`
    },
    toggleEditMode () {
      this.editMode = !this.editMode
    },
    async removeTemplate (templateTitle) {
      if (confirm(`Remove "${templateTitle}" from quick add templates?`)) {
        await this.$store.dispatch('fridge/removeTemplate', templateTitle)
      }
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
  max-width: 400px;
  // Capped and scrolling, like the other two sheets. Without this the box
  // grew with the existing-foods grid, and a flex-centred child taller than
  // the viewport is clipped at the TOP — the header and the close button
  // were above the screen on a phone.
  max-height: 90vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--fr-line);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;

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
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background 0.2s;

    &:hover {
      background: var(--fr-field);
    }
  }
}

.timer-form {
  .form-group {
    margin-bottom: 1.5rem;

    label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
      color: var(--fr-text);
    }

    input {
      width: 100%;
      padding: 1rem;
      background: var(--fr-field);
      border: 1px solid var(--fr-line);
      border-radius: 8px;
      color: var(--fr-text);
      font-size: 1rem;

      &::placeholder {
        color: var(--fr-faint);
      }

      &:focus {
        outline: none;
        border-color: var(--fr-muted);
        background: var(--fr-line);
      }
    }
  }

  .expiry-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-top: 0.5rem;

    .expiry-btn {
      padding: 1rem;
      background: var(--fr-field);
      border: 2px solid var(--fr-line);
      border-radius: 8px;
      color: var(--fr-text);
      cursor: pointer;
      font-size: 1rem;
      font-weight: 500;
      transition: all 0.2s;

      &:hover {
        background: var(--fr-line);
        border-color: var(--fr-faint);
      }

      &.active {
        background: var(--fr-accent);
        border-color: var(--fr-accent);
        color: var(--fr-text);
      }
    }
  }

  .form-actions {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;

    .cancel-btn, .add-btn {
      padding: 1rem 2rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .cancel-btn {
      background: var(--fr-field);
      color: var(--fr-text);
      border: 1px solid var(--fr-line);

      &:hover {
        background: var(--fr-line);
      }
    }

    .add-btn {
      background: var(--fr-accent);
      color: var(--fr-text);

      &:hover:not(:disabled) {
        background: #45a049;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
}

.quick-add-section {
  margin-bottom: 2rem;

  .quick-add-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;

    h3 {
      color: var(--fr-text);
      font-size: 1.2rem;
      font-weight: 600;
      margin: 0;
    }

    .edit-btn {
      background: var(--fr-field);
      border: 1px solid var(--fr-line);
      border-radius: 6px;
      color: var(--fr-text);
      cursor: pointer;
      padding: 0.5rem;
      font-size: 1rem;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;

      &:hover {
        background: var(--fr-line);
        border-color: var(--fr-faint);
      }

      &.active {
        background: var(--fr-text);
        border-color: var(--fr-text);
        color: #333;
      }
    }
  }

  .template-buttons {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    max-height: 200px;
    overflow-y: auto;
    padding-right: 4px;

    /* Custom scrollbar styling */
    &::-webkit-scrollbar {
      width: 6px;
    }

    &::-webkit-scrollbar-track {
      background: var(--fr-field);
      border-radius: 3px;
    }

    &::-webkit-scrollbar-thumb {
      background: var(--fr-line);
      border-radius: 3px;

      &:hover {
        background: var(--fr-line);
      }
    }

    .template-item {
      position: relative;
      display: flex;
      flex-direction: column;

      .template-btn {
        background: var(--fr-accent);
        border: 2px solid var(--fr-accent);
        border-radius: 8px;
        padding: 0.75rem;
        color: var(--fr-text);
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        text-align: center;
        width: 100%;

        &:hover:not(.disabled) {
          background: var(--fr-accent);
          border-color: var(--fr-accent);
          transform: translateY(-2px);
        }

        &:active:not(.disabled) {
          transform: translateY(0);
        }

        &.disabled {
          opacity: 0.6;
          cursor: default;
        }

        .template-name {
          font-weight: 600;
          margin-bottom: 0.25rem;
          font-size: 0.9rem;
        }

        .template-duration {
          font-size: 0.75rem;
          opacity: 0.8;
        }
      }

      .remove-btn {
        position: absolute;
        top: -8px;
        right: -8px;
        background: var(--fr-text);
        border: 1px solid var(--fr-line);
        border-radius: 50%;
        color: #333;
        cursor: pointer;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        z-index: 10;

        &:hover {
          background: var(--fr-text);
          transform: scale(1.1);
        }
      }
    }
  }

  .divider {
    height: 1px;
    background: var(--fr-line);
    margin: 0;
  }
}

.custom-form-header {
  h3 {
    color: var(--fr-text);
    margin-bottom: 1.5rem;
    font-size: 1.2rem;
    font-weight: 600;
  }
}

@media (max-width: 480px) {
  .modal-content {
    padding: 1.5rem;
    margin: 1rem;
  }

  .form-actions {
    flex-direction: column;

    .cancel-btn, .add-btn {
      width: 100%;
    }
  }

  .quick-add-section .template-buttons {
    grid-template-columns: 1fr 1fr;
  }
}
</style>