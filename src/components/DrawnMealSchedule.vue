<template>
  <div class="drawn-meals-schedule my-4 md-col-8">
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
            <button class="btn btn-sm btn-warning delete-button" @click.stop="deleteMeal(element)">Delete</button>
            <i v-if="selectedMeal.id !== element.id" class="bi bi-grip-vertical"/>
          </li>
        </template>
      </draggable>
    </div>
    <p v-else>No meals have been drawn yet.</p>
  </div>
</template>

<script>
import draggable from 'vuedraggable';

export default {
  name: 'DrawnMealSchedule',
  components: {
    draggable
  },
  data () {
    return {
      selectedMeal: {},
      drag: false
    }
  },
  computed: {
    drawnMeals () {
      if (!this.$store.state.drawnMealsWithHistory || !this.$store.state.drawnMealsWithHistory.length) {
        return [];
      } else {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        return this.$store.state.drawnMealsWithHistory.map((drawnMeal) => {
          return {
            ...drawnMeal,
            meal: this.$store.getters.getMeal(drawnMeal.mealId)
          }
        }).filter((drawnMeal) => {
          return drawnMeal.meal && new Date(drawnMeal.assignedDate) >= oneWeekAgo;
        });
      }
    }
  },
  methods: {
    startDrag (event) {
      this.drag = true;
    },
    endDrag (event) {
      this.drag = false;

      // Get the dragged item and the item at the new index.
      const draggedItem = this.drawnMeals[event.oldIndex];
      const itemAtNewIndex = this.drawnMeals[event.newIndex];

      // Swap the meal and mealId of the dragged item and the item at the new index.
      [draggedItem.meal, itemAtNewIndex.meal] = [itemAtNewIndex.meal, draggedItem.meal];
      [draggedItem.mealId, itemAtNewIndex.mealId] = [itemAtNewIndex.mealId, draggedItem.mealId];

      const draggedItemDbEntry = {
        path: `drawnMeals/${draggedItem.id}`,
        value: {
          assignedDate: draggedItem.assignedDate,
          mealId: draggedItem.mealId,
          id: draggedItem.id
        }
      }

      const itemAtNewIndexDbEntry = {
        path: `drawnMeals/${itemAtNewIndex.id}`,
        value: {
          assignedDate: itemAtNewIndex.assignedDate,
          mealId: itemAtNewIndex.mealId,
          id: itemAtNewIndex.id
        }
      }

      this.$store.dispatch('updateDBValue', draggedItemDbEntry);
      this.$store.dispatch('updateDBValue', itemAtNewIndexDbEntry);
    },
    formatDate (dateString) {
      const options = { weekday: 'short', month: 'numeric', day: 'numeric' };
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', options);
    },
    toggleDeleteButton (drawnMeal) {
      if (this.selectedMeal.id === drawnMeal.id) {
        this.selectedMeal = {};
      } else {
        this.selectedMeal = drawnMeal;
      }
    },
    deleteMeal (drawnMeal) {
      const dbEntry = {
        path: `drawnMeals/${drawnMeal.id}`,
        value: null
      }

      this.$store.dispatch('updateDBValue', dbEntry);
    },
    nextMeal (drawnMeal) {
      const now = new Date();

      const cutOffTime = new Date();
      cutOffTime.setHours(18, 0, 0, 0);

      this.drawnMeals.sort((a, b) => new Date(a.assignedDate) - new Date(b.assignedDate));

      const nextMeal = this.drawnMeals.find(meal => {
        const mealDate = new Date(meal.assignedDate);
        return mealDate > now || (mealDate.toDateString() === now.toDateString() && now < cutOffTime);
      });

      return drawnMeal === nextMeal;
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
            border-bottom: none;
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
          border-left: none;

          .schedule-meal {
            justify-content: flex-start;
            padding: 8px 6px 8px 12px;
            display: flex;
            justify-content: space-between;
            position: relative;

            &.hide-delete .delete-button{
              width: 0;
              padding: 0;
              border: none;
              pointer-events: none;
              opacity: 0;
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