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
            <li v-for="use in plan.uses" :key="use.timerId" class="cooked-row">
              <span class="cooked-name">{{ use.name }}</span>
              <span class="cooked-change" :class="{ clears: use.clears }">
                {{ use.clears ? 'used up' : `${use.before} → ${use.after}` }}
              </span>
            </li>
          </ul>
        </div>

        <!-- A guess that clears a timer has to be visible BEFORE it happens.
             Explaining it afterwards is how food quietly goes missing. -->
        <p v-if="plan.assuming" class="cooked-warn">
          {{ plan.assuming === 1 ? 'One item has' : `${plan.assuming} items have` }}
          no package size recorded, so this assumes a whole package.
          Set a package size on the food to make it exact.
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
import { planMealConsumption } from '@/store/fridge/consume';
import { todayISO } from '@/store/schedule';

export default {
  name: 'MealCookedSheet',
  components: { AppModal },
  props: {
    meal: { type: Object, required: true }
  },
  emits: ['close', 'done'],
  data () {
    return { working: false };
  },
  computed: {
    plan () {
      return planMealConsumption({
        meal: this.meal,
        catalog: this.$store.state.groceryCatalog || {},
        timers: this.$store.state.fridge.timers || {}
      });
    }
  },
  methods: {
    async confirm () {
      this.working = true;
      try {
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

.cooked-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
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
