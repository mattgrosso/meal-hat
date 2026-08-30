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
            <button class="btn btn-sm btn-success made-button" @click.stop="openCookedSheet(element)">Made it</button>
            <button class="btn btn-sm btn-warning delete-button" @click.stop="deleteMeal(element)">Delete</button>
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
  </div>
</template>

<script>
import draggable from 'vuedraggable';
import MealCookedSheet from '@/components/MealCookedSheet.vue';
import {
  toISODate, fromISODate, withDrawnDate, nextMealId
} from '@/store/schedule';

export default {
  name: 'DrawnMealSchedule',
  components: {
    MealCookedSheet,
    draggable
  },
  data () {
    return {
      selectedMeal: {},
      drag: false,
      // The meal whose "made it" sheet is open, or null. Holds the MEAL, not
      // the drawn row: the plan is about the recipe's ingredients.
      cookingMeal: null
    }
  },
  computed: {
    // Which meal gets the green highlight. The rule lives in the store so it
    // can be tested directly — see nextMealId, and the off-by-one-day bug it
    // exists to have prevented.
    nextMealId () {
      return nextMealId(this.drawnMeals);
    },
    drawnMeals () {
      if (!this.$store.state.drawnMealsWithHistory || !this.$store.state.drawnMealsWithHistory.length) {
        return [];
      } else {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const cutoff = toISODate(oneWeekAgo);

        return this.$store.state.drawnMealsWithHistory.map((drawnMeal) => {
          return {
            ...drawnMeal,
            meal: this.$store.getters.getMeal(drawnMeal.mealId)
          }
        }).filter((drawnMeal) => {
          const date = toISODate(drawnMeal.assignedDate);
          return drawnMeal.meal && date && date >= cutoff;
        });
      }
    }
  },
  methods: {
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
            padding: 8px 6px 8px 12px;
            position: relative;

            &.hide-delete .delete-button,
            &.hide-delete .made-button {
              width: 0;
              padding: 0;
              border: 0;
              pointer-events: none;
              opacity: 0;
            }

            // Same reveal as Delete, so tapping a row shows both actions and
            // the meal name keeps its width until then.
            .made-button {
              width: 80px;
              margin-right: 4px;
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
              width: 75px;
              transition: all 0.10s ease-out;
              white-space: nowrap;
              display: flex;
              justify-content: center;
              align-items: center;
              line-height: 1;
              opacity: 1;
              position: absolute;
              right: 10px;
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