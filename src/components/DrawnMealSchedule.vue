<template>
  <div class="drawn-meals-schedule my-4">
    <h3>Meal Schedule</h3>
    <div v-if="drawnMeals.length" class="schedule">
      <ul class="meals-dates">
        <li class="schedule-date" v-for="drawnMeal in drawnMeals" :key="drawnMeal.id" :class="{'next-meal': nextMeal(drawnMeal)}">
          <span>
            {{ formatDate(drawnMeal.assignedDate) }}
          </span>
        </li>
      </ul>
      <draggable
        class="meals-list"
        v-model="drawnMeals"
        :item-key="id"
        tag="ul"
        handle=".bi-grip-vertical"
        @start="startDrag"
        @end="endDrag"
      >
        <template #item="{element}">
          <li class="schedule-meal" :class="{'next-meal': nextMeal(element), 'hide-delete': selectedMeal.id !== element.id }" @click="toggleDeleteButton(element)">
            <span class="">
              {{ element.meal.name }}
            </span>
            <!-- Revealed by tapping the row, alongside Delete. Icon-only,
                 because this row is one column of a two-column grid — it has
                 roughly half the phone's width, and two text buttons did not
                 fit in it. -->
            <button
              class="btn btn-sm btn-success made-button"
              title="I made this"
              aria-label="I made this"
              @click.stop="openCookedSheet(element)"
            ><i class="bi bi-check-lg"></i></button>
            <button
              class="btn btn-sm btn-warning delete-button"
              title="Remove this meal from the schedule"
              aria-label="Remove this meal from the schedule"
              @click.stop="confirmDelete(element)"
            ><i class="bi bi-trash-fill"></i></button>
            <i v-if="selectedMeal.id !== element.id" class="bi bi-grip-vertical"/>
          </li>
        </template>
      </draggable>
    </div>
    <p v-else>No meals have been drawn yet.</p>

    <!-- Nothing is written until this is confirmed. Checking a meal off can
         clear timers, and clearing is the one thing this app will not do
         quietly. -->
    <MealCookedSheet
      v-if="cookingMeal"
      :meal="cookingMeal"
      @close="cookingMeal = null"
    />

    <!-- Bug report (2026-08-31, Carrie): "I'd like to be able to manually
         enter a meal." The schedule could reorder and delete; the only way to
         get anything ONTO it was the draw. -->
    <button class="btn btn-outline-primary btn-sm mt-3" @click="openAddMeal">
      <i class="bi bi-plus-lg me-1"></i>Add a meal
    </button>

    <AppModal
      v-if="addingMeal"
      :show-modal="true"
      title="Add a meal"
      primary-button-text="Add it"
      secondary-button-text="Cancel"
      :primary-button-callback="reallyAddMeal"
      :secondary-button-callback="closeAddMeal"
      :close-modal-callback="closeAddMeal"
    >
      <div class="mb-3">
        <label class="form-label" for="add-meal-date">Date</label>
        <input id="add-meal-date" v-model="addDate" type="date" class="form-control" />
      </div>

      <div class="mb-3">
        <label class="form-label" for="add-meal-pick">Meal</label>
        <select id="add-meal-pick" v-model="addMealId" class="form-select">
          <option value="">Something else&hellip;</option>
          <option v-for="meal in hatMealsByName" :key="meal.id" :value="meal.id">
            {{ meal.name }}
          </option>
        </select>
      </div>

      <!-- The one-off: a night the hat has no opinion about. Nothing is added
           to the hat — "we're getting pizza" isn't a meal you want drawn
           later — so it brings no ingredients and the shopping list is
           unaffected. -->
      <div v-if="!addMealId" class="mb-3">
        <label class="form-label" for="add-meal-name">What are you having?</label>
        <input
          id="add-meal-name"
          v-model.trim="addOneOffName"
          class="form-control"
          maxlength="80"
          placeholder="Takeout, leftovers, dinner at Mom's…"
        />
        <div class="form-text">
          Just for this night. It won't go in the hat or on the shopping list.
        </div>
      </div>

      <p v-if="addError" class="text-danger small mb-0">{{ addError }}</p>
    </AppModal>

    <!-- Deleting is destructive and silent: it drops the schedule row, rolls
         back the meal's drawn history AND regenerates the shopping list. It
         now sits behind a confirm, because the button is a 40px target next
         to one you press most nights. -->
    <AppModal
      v-if="deletingMeal"
      :show-modal="true"
      title="Remove this meal?"
      primary-button-text="Remove it"
      secondary-button-text="Keep it"
      :primary-button-callback="reallyDelete"
      :secondary-button-callback="() => (deletingMeal = null)"
      :close-modal-callback="() => (deletingMeal = null)"
    >
      <p class="mb-0">
        <strong>{{ deletingMeal.meal ? deletingMeal.meal.name : 'This meal' }}</strong>
        comes off {{ formatDate(deletingMeal.assignedDate) }}, and the shopping
        list is rebuilt without its ingredients.
      </p>
    </AppModal>
  </div>
</template>

<script>
import draggable from 'vuedraggable';
import MealCookedSheet from '@/components/MealCookedSheet.vue';
import AppModal from '@/components/Modal.vue';
import {
  toISODate, fromISODate, withDrawnDate, nextMealId
} from '@/store/schedule';

export default {
  name: 'DrawnMealSchedule',
  components: {
    MealCookedSheet,
    AppModal,
    draggable
  },
  data () {
    return {
      selectedMeal: {},
      drag: false,
      // The meal whose "made it" sheet is open, or null. Holds the MEAL, not
      // the drawn row: the plan is about the recipe's ingredients.
      cookingMeal: null,
      // The row awaiting a delete confirm, or null.
      deletingMeal: null,
      // The "add a meal" dialog.
      addingMeal: false,
      addDate: '',
      addMealId: '',
      addOneOffName: '',
      addError: '',
      addBusy: false
    }
  },
  computed: {
    // Which meal gets the green highlight. The rule lives in the store so it
    // can be tested directly — see nextMealId, and the off-by-one-day bug it
    // exists to have prevented.
    nextMealId () {
      return nextMealId(this.drawnMeals);
    },
    // The hat's meals, A-Z — the draw's own order is deliberately random, and
    // a picker you're scanning for one name wants the opposite.
    hatMealsByName () {
      const meals = this.$store.state.meals;
      if (typeof meals !== 'object' || meals === null) return [];
      return Object.values(meals)
        .filter((meal) => meal?.id && meal.name)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
    drawnMeals () {
      if (!this.$store.state.drawnMealsWithHistory || !this.$store.state.drawnMealsWithHistory.length) {
        return [];
      } else {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const cutoff = toISODate(oneWeekAgo);

        return this.$store.state.drawnMealsWithHistory.map((drawnMeal) => {
          // A hand-placed one-off carries its own name and has no hat entry
          // (store scheduleMeal). Without this fallback the filter below would
          // drop it on the floor — the row would simply never appear, which is
          // the worst possible outcome for something you typed in yourself.
          const meal = this.$store.getters.getMeal(drawnMeal.mealId) ||
            (drawnMeal.name ? { id: drawnMeal.id, name: drawnMeal.name, oneOff: true } : null);

          return { ...drawnMeal, meal };
        }).filter((drawnMeal) => {
          const date = toISODate(drawnMeal.assignedDate);
          return drawnMeal.meal && date && date >= cutoff;
        });
      }
    }
  },
  methods: {
    openAddMeal () {
      this.addError = '';
      this.addMealId = '';
      this.addOneOffName = '';
      // Default to the first day the schedule has nothing on, so the common
      // case — filling a gap the draw left — is one tap.
      this.addDate = this.firstFreeDate();
      this.addingMeal = true;
    },
    closeAddMeal () {
      this.addingMeal = false;
    },
    // Today, or the earliest later day with no meal on it. Looks a fortnight
    // ahead and then gives up and returns today rather than running forever.
    firstFreeDate () {
      const taken = new Set(this.drawnMeals.map((d) => toISODate(d.assignedDate)));
      const day = new Date();
      for (let i = 0; i < 14; i++) {
        const iso = toISODate(day);
        if (iso && !taken.has(iso)) return iso;
        day.setDate(day.getDate() + 1);
      }
      return toISODate(new Date());
    },
    async reallyAddMeal () {
      if (this.addBusy) return;
      this.addError = '';

      const isoDate = toISODate(this.addDate);
      if (!isoDate) {
        this.addError = 'Pick a date first.';
        return;
      }

      const meal = this.addMealId
        ? this.$store.getters.getMeal(this.addMealId)
        : null;

      if (!meal && !this.addOneOffName) {
        this.addError = 'Pick a meal, or say what you\'re having.';
        return;
      }

      this.addBusy = true;
      try {
        await this.$store.dispatch('scheduleMeal', {
          meal,
          isoDate,
          oneOffName: meal ? '' : this.addOneOffName
        });
        this.addingMeal = false;
      } catch (error) {
        this.addError = 'Could not add that just now. Try again in a moment.';
      } finally {
        this.addBusy = false;
      }
    },
    startDrag (event) {
      this.drag = true;
    },
    async endDrag (event) {
      this.drag = false;

      // Get the dragged item and the item at the new index.
      const draggedItem = this.drawnMeals[event.newIndex];
      const itemAtNewIndex = this.drawnMeals[event.oldIndex];

      // The two meals trade places; the DATES stay where they are.
      const meal1 = draggedItem.meal;
      const meal2 = itemAtNewIndex.meal;
      const date1 = toISODate(draggedItem.assignedDate);
      const date2 = toISODate(itemAtNewIndex.assignedDate);

      // Swap the meal and mealId of the dragged item and the item at the new index.
      [draggedItem.meal, itemAtNewIndex.meal] = [itemAtNewIndex.meal, draggedItem.meal];
      [draggedItem.mealId, itemAtNewIndex.mealId] = [itemAtNewIndex.mealId, draggedItem.mealId];

      // One atomic write for the whole swap. This was four separate set() calls
      // — two schedule rows and two meals — so an interruption could leave the
      // schedule showing one arrangement and the meals' drawn history another.
      await this.$store.dispatch('reassignDrawnMeals', {
        rows: [
          { id: draggedItem.id, mealId: draggedItem.mealId, assignedDate: date1 },
          { id: itemAtNewIndex.id, mealId: itemAtNewIndex.mealId, assignedDate: date2 }
        ],
        meals: [
          withDrawnDate(this.replaceDrawnDate(meal1, date1, date2), date2),
          withDrawnDate(this.replaceDrawnDate(meal2, date2, date1), date1)
        ]
      });

      // Regenerate shopping list since meal dates may have changed
      await this.$store.dispatch('generateShoppingListFromMeals');
    },
    // Drop the date a meal is moving OFF, so withDrawnDate can add the one it is
    // moving ON to without leaving the old one behind.
    replaceDrawnDate (meal, oldDate, newDate) {
      if (!meal) return meal;

      const drawnDates = (meal.drawnDates || [])
        .map(toISODate)
        .filter((date) => date && date !== oldDate && date !== newDate);

      return { ...meal, drawnDates };
    },
    formatDate (dateString) {
      // fromISODate, not new Date(): a bare 'YYYY-MM-DD' parses as UTC midnight,
      // which renders as the previous day anywhere west of Greenwich.
      const date = fromISODate(dateString);
      if (!date) return '';

      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    },
    toggleDeleteButton (drawnMeal) {
      if (this.selectedMeal.id === drawnMeal.id) {
        this.selectedMeal = {};
      } else {
        this.selectedMeal = drawnMeal;
      }
    },
    confirmDelete (drawnMeal) {
      if (!drawnMeal) return;
      this.deletingMeal = drawnMeal;
    },
    async reallyDelete () {
      const drawnMeal = this.deletingMeal;
      this.deletingMeal = null;
      if (drawnMeal) await this.deleteMeal(drawnMeal);
    },
    openCookedSheet (drawnMeal) {
      // `element.meal` is resolved from the hat by the drawnMeals computed; a
      // drawn row whose meal has since been deleted has nothing to consume.
      if (!drawnMeal || !drawnMeal.meal) return;
      this.cookingMeal = drawnMeal.meal;
    },
    async deleteMeal (drawnMeal) {
      const isoDate = toISODate(drawnMeal.assignedDate);
      const meal = drawnMeal.meal;

      // Remove the schedule row and roll back the meal's drawn history together,
      // so a meal can never be left marked as drawn for a day it is no longer on
      // (which would keep it ineligible under minDaysBetween for no reason).
      await this.$store.dispatch('reassignDrawnMeals', {
        rows: [{ id: drawnMeal.id, value: null }],
        meals: meal && meal.id ? [this.replaceDrawnDate(meal, isoDate, isoDate)] : []
      });

      // Regenerate shopping list to remove ingredients from deleted meal
      await this.$store.dispatch('generateShoppingListFromMeals');
    },
    nextMeal (drawnMeal) {
      return Boolean(this.nextMealId) && drawnMeal.id === this.nextMealId;
    }
  },
};
</script>

<style lang="scss">
  .drawn-meals-schedule {
    text-align: center;
    margin: 0 auto;

    .schedule {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 0;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);

      ul {
        border-radius: 6px;
        border: 1px solid #ccc;
        display: grid;
        grid-auto-rows: 1fr;
        list-style: none;
        margin: 0;
        padding: 0;

        li {
          align-items: center;
          border-bottom: 1px solid #ccc;
          display: flex;
          font-size: 1rem;
          padding: 16px 0;
          text-align: left;
          transition: background-color 0.3s ease;

          &.next-meal {
            font-weight: bold;
            color: #408558;
          }

          &:last-of-type {
            border-bottom: 0;
          }
        }

        &.meals-dates {
          border-top-right-radius: 0;
          border-bottom-right-radius: 0;

          .schedule-date {
            justify-content: flex-end;
            padding: 8px 12px 8px 6px;
          }
        }

        &.meals-list {
          border-top-left-radius: 0;
          border-bottom-left-radius: 0;
          border-left: 0;

          .schedule-meal {
            cursor: pointer;
            display: flex;
            justify-content: flex-start;
            justify-content: space-between;
            align-items: center;
            gap: 4px;
            padding: 8px 6px 8px 12px;
            position: relative;

            // Without this a long meal name refuses to shrink and pushes the
            // row wider than the phone.
            > span:first-child {
              min-width: 0;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              transition: padding-right 0.10s ease-out;
            }

            // Both buttons float above the row, so while they are showing the
            // name has to be held clear of them or it slides underneath.
            // 96px = 56 + 40, the far edge of the delete button.
            &:not(.hide-delete) > span:first-child {
              padding-right: 96px;
            }

            &.hide-delete .delete-button,
            &.hide-delete .made-button {
              width: 0;
              padding: 0;
              border: 0;
              pointer-events: none;
              opacity: 0;
            }

            // ABSOLUTELY POSITIONED, because .delete-button is.
            //
            // Delete floats over the row at right:10px and is out of normal
            // flow. An in-flow button lands in exactly that spot and sits
            // UNDERNEATH it — invisible, except for a tenth of a second as
            // Delete fades out, which is precisely what Matt saw. It was never
            // an overflow problem; it was covered.
            //
            // The check sits at the right edge — it is the one pressed most
            // nights. Delete moves inboard of it, so the destructive control
            // is not the one under your thumb.
            .made-button {
              width: 40px;
              position: absolute;
              right: 10px;
              top: 50%;
              transform: translateY(-50%);
              transition: all 0.10s ease-out;
              white-space: nowrap;
              display: flex;
              justify-content: center;
              align-items: center;
              line-height: 1;
              opacity: 1;
              overflow: hidden;
            }

            .delete-button {
              width: 40px;
              transition: all 0.10s ease-out;
              white-space: nowrap;
              display: flex;
              justify-content: center;
              align-items: center;
              line-height: 1;
              opacity: 1;
              position: absolute;
              right: 56px;
              top: 50%;
              transform: translateY(-50%);
            }

            .bi-grip-vertical {
              cursor: move;
            }
          }
        }
      }
    }
  }
</style>