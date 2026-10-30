<template>
  <AppModal
    :show-modal="true"
    :title="`Made ${meal.name}?`"
    :primary-button-text="working ? 'Saving…' : 'Yes, made it'"
    secondary-button-text="Cancel"
    :primary-button-callback="confirm"
    :secondary-button-callback="() => $emit('close')"
    :close-modal-callback="() => $emit('close')"
  >
    <div class="cooked-sheet">
        <p v-if="!plan.uses.length && !plan.missing.length" class="cooked-note">
          This meal has no ingredients recorded, so nothing in the fridge changes.
          Checking it off still records that you made it.
        </p>

        <div v-if="plan.uses.length" class="cooked-section">
          <h6 class="cooked-heading">From the fridge</h6>
          <ul class="cooked-list">
            <li v-for="use in plan.uses" :key="use.timerId" class="cooked-item">
              <div class="cooked-row">
                <span class="cooked-name">
                  {{ use.name }}
                  <span v-if="use.assumedPackageSize" class="cooked-guess">guess</span>
                </span>
                <span class="cooked-change" :class="{ clears: use.clears }">
                  {{ use.clears ? 'used up' : `${use.before} → ${use.after}` }}
                </span>
              </div>
              <!-- Fix the guess where it shows. The pencil on the shopping list
                   is the other place to set this, but a food you just cooked
                   from is in the house, so it is rarely on the list. Kept up
                   while it is being typed in (sizeDrafts), so a row does not
                   vanish under the cursor once the number makes it exact. -->
              <div v-if="sizeFieldFor(use)" class="cooked-size">
                <label :for="`size-${use.groceryId}`">One package holds</label>
                <div class="input-group input-group-sm">
                  <input
                    :id="`size-${use.groceryId}`"
                    v-model="sizeDrafts[use.groceryId]"
                    type="number"
                    min="0"
                    step="any"
                    inputmode="decimal"
                    class="form-control"
                    @change="saveSize(use.groceryId)"
                  >
                  <span class="input-group-text">{{ use.units || 'units' }}</span>
                </div>
                <p class="cooked-size-hint">
                  This meal uses {{ use.needed }}{{ use.units ? ` ${use.units}` : '' }}.
                </p>
              </div>
            </li>
          </ul>
        </div>

        <!-- A guess that clears a timer has to be visible BEFORE it happens.
             Explaining it afterwards is how food quietly goes missing. -->
        <p v-if="plan.assuming" class="cooked-warn">
          {{ plan.assuming === 1 ? 'One item has' : `${plan.assuming} items have` }}
          no package size recorded, so this assumes a whole package.
          Fill in how much one package holds to make it exact.
        </p>

        <div v-if="plan.missing.length" class="cooked-section">
          <h6 class="cooked-heading">Not taken from the fridge</h6>
          <ul class="cooked-list">
            <li v-for="item in plan.missing" :key="item.groceryId + (item.short ? '-short' : '')" class="cooked-row">
              <span class="cooked-name">{{ item.name }}</span>
              <span class="cooked-missing">
                {{ item.short ? 'not enough tracked' : 'not in the fridge' }}
              </span>
            </li>
          </ul>
          <p class="cooked-note">
            Nothing is changed for these. The fridge only knows what has been
            photographed, so a missing item means no record — not that you are out.
          </p>
        </div>
    </div>
  </AppModal>
</template>

<script>
// Checking a meal off after cooking it.
//
// Two things happen, and they are independent on purpose: the fridge gets what
// the meal ate, and the meal records that it was actually made. Either is
// useful without the other — a meal with nothing tracked in the fridge is still
// worth marking cooked, because that is what the draw's overdue weighting reads.
//
// Nothing is written until the person confirms. The plan on screen IS the plan
// that gets applied (see store/fridge/consume.js), so what you agreed to and
// what happens cannot drift apart.
import AppModal from '@/components/Modal.vue';
import { trackEvent } from '@/utils/usage.js';
import { planMealConsumption } from '@/store/fridge/consume';
import { todayISO } from '@/store/schedule';

const packageSizeValue = (typed) => {
  const n = Number(typed);
  return typed !== '' && typed !== null && Number.isFinite(n) && n > 0 ? n : null;
};

export default {
  name: 'MealCookedSheet',
  components: { AppModal },
  props: {
    meal: { type: Object, required: true }
  },
  emits: ['close', 'done'],
  data () {
    // groceryId -> what is typed in that food's package-size field. A key
    // appears on the first keystroke, and keeps the field up once the number
    // makes the row exact.
    return { working: false, sizeDrafts: {} };
  },
  computed: {
    // The catalog with whatever has been typed laid over it, so "used up"
    // becomes "2 → 1.25" as the number goes in, before anything is saved.
    catalog () {
      const catalog = this.$store.state.groceryCatalog || {};
      const overlaid = { ...catalog };
      Object.entries(this.sizeDrafts).forEach(([id, typed]) => {
        if (overlaid[id]) overlaid[id] = { ...overlaid[id], packageSize: packageSizeValue(typed) };
      });
      return overlaid;
    },
    plan () {
      return planMealConsumption({
        meal: this.meal,
        catalog: this.catalog,
        timers: this.$store.state.fridge.timers || {}
      });
    }
  },
  methods: {
    // A guessed food shows a field; one already being typed in keeps it.
    // Decided per render, not once on open, because the fridge's timers can
    // land after the sheet does.
    sizeFieldFor (use) {
      if (!use.groceryId) return false;
      if (!use.assumedPackageSize && !(use.groceryId in this.sizeDrafts)) return false;
      // One field per food, on the first of its rows, even across two timers.
      return this.plan.uses.find((u) => u.groceryId === use.groceryId) === use;
    },
    // Saves just this one field on the food, under the pencil editor's rule:
    // blank means unknown, which is not the same as 1. Field-scoped, so it
    // cannot clobber anything else edited on the entry elsewhere.
    async saveSize (groceryId) {
      const value = packageSizeValue(this.sizeDrafts[groceryId]);
      const entry = (this.$store.state.groceryCatalog || {})[groceryId];
      if (!entry || (entry.packageSize || null) === value) return;
      await this.$store.dispatch('updateDBValue', {
        path: `grocery-catalog/${groceryId}/packageSize`,
        value
      });
    },
    async confirm () {
      trackEvent('meal-cooked');
      this.working = true;
      try {
        // A number typed and then straight into the button may not have
        // fired its change event yet. The plan already used it; save it too.
        await Promise.all(Object.keys(this.sizeDrafts).map((id) => this.saveSize(id)));
        await this.$store.dispatch('fridge/applyConsumption', {
          plan: this.plan,
          mealName: this.meal.name
        });
        await this.$store.dispatch('markMealCooked', {
          mealId: this.meal.id,
          date: todayISO()
        });
        this.$emit('done');
      } finally {
        // Even on failure: the sheet must not strand itself in a saving state
        // with no way out.
        this.working = false;
        this.$emit('close');
      }
    }
  }
};
</script>

<style lang="scss" scoped>
.cooked-section {
  margin-bottom: 1rem;
}

.cooked-heading {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
  margin-bottom: 0.35rem;
}

.cooked-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.cooked-item {
  padding: 0.4rem 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.cooked-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
}

.cooked-guess {
  font-size: 0.75rem;
  margin-left: 0.35rem;
  padding: 0.05rem 0.4rem;
  border-radius: 4px;
  background: rgba(255, 193, 7, 0.25);
}

.cooked-size {
  text-align: left;
  margin-top: 0.35rem;
  font-size: 0.85rem;

  label {
    display: block;
    margin-bottom: 0.2rem;
    opacity: 0.75;
  }

  .input-group {
    max-width: 12rem;
  }
}

.cooked-size-hint {
  margin: 0.2rem 0 0;
  opacity: 0.6;
}

.cooked-change.clears {
  font-weight: 600;
}

.cooked-change,
.cooked-missing {
  font-size: 0.9rem;
  opacity: 0.7;
  white-space: nowrap;
}

.cooked-note {
  font-size: 0.85rem;
  opacity: 0.65;
  margin: 0.5rem 0 0;
}

.cooked-warn {
  font-size: 0.85rem;
  margin: 0.5rem 0 1rem;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  background: rgba(255, 193, 7, 0.15);
}
</style>
