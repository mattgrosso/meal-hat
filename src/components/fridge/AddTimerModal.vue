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

      // Save as template for future use
      this.$store.dispatch('fridge/saveTemplate', {
        title: title,
        days: days
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
  max-width: 400px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;

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
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background 0.2s;

    &:hover {
      background: rgba(255, 255, 255, 0.1);
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
      color: #fff;
    }

    input {
      width: 100%;
      padding: 1rem;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;

      &::placeholder {
        color: rgba(255, 255, 255, 0.5);
      }

      &:focus {
        outline: none;
        border-color: rgba(255, 255, 255, 0.6);
        background: rgba(255, 255, 255, 0.15);
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
      background: rgba(255, 255, 255, 0.1);
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      color: #fff;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 500;
      transition: all 0.2s;

      &:hover {
        background: rgba(255, 255, 255, 0.2);
        border-color: rgba(255, 255, 255, 0.5);
      }

      &.active {
        background: #4CAF50;
        border-color: #4CAF50;
        color: white;
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
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.3);

      &:hover {
        background: rgba(255, 255, 255, 0.2);
      }
    }

    .add-btn {
      background: #4CAF50;
      color: white;

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
      color: #fff;
      font-size: 1.2rem;
      font-weight: 600;
      margin: 0;
    }

    .edit-btn {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      color: #fff;
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
        background: rgba(255, 255, 255, 0.2);
        border-color: rgba(255, 255, 255, 0.5);
      }

      &.active {
        background: rgba(255, 255, 255, 0.9);
        border-color: rgba(255, 255, 255, 0.9);
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
      background: rgba(255, 255, 255, 0.05);
      border-radius: 3px;
    }

    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;

      &:hover {
        background: rgba(255, 255, 255, 0.3);
      }
    }

    .template-item {
      position: relative;
      display: flex;
      flex-direction: column;

      .template-btn {
        background: rgba(76, 175, 80, 0.1);
        border: 2px solid rgba(76, 175, 80, 0.3);
        border-radius: 8px;
        padding: 0.75rem;
        color: #fff;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        text-align: center;
        width: 100%;

        &:hover:not(.disabled) {
          background: rgba(76, 175, 80, 0.2);
          border-color: rgba(76, 175, 80, 0.5);
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
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.3);
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
          background: rgba(255, 255, 255, 1);
          transform: scale(1.1);
        }
      }
    }
  }

  .divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.2);
    margin: 0;
  }
}

.custom-form-header {
  h3 {
    color: #fff;
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