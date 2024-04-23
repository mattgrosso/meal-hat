<template>
  <div class="drawn-meals-schedule my-4 md-col-8">
    <h3>Meal Schedule</h3>
    <ul v-if="drawnMeals.length">
      <li v-for="(drawnMeal, index) in drawnMeals" :key="index" :class="{'next-meal': nextMeal(drawnMeal)}">
        <span class="date-and-title">
          {{ drawnMeal.assignedDate }} - {{ drawnMeal.meal.name }}
        </span>
        <span class="delete-meal" @click="deleteMeal(drawnMeal)">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle" viewBox="0 0 16 16">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
          </svg>
        </span>
      </li>
    </ul>
    <p v-else>No meals have been drawn yet.</p>
  </div>
</template>

<script>
export default {
  name: 'DrawnMealSchedule',
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

    ul {
      list-style: none;
      padding: 0;
      border: 1px solid #ccc;
      border-radius: 6px;
      padding: 0 32px;
      background-color: #f8f9fa;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);

      li {
        border-bottom: 1px solid #ccc;
        padding: 16px 0;
        text-align: left;
        font-size: 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: background-color 0.3s ease;

        &:hover {
          background-color: #e9ecef;
        }

        &.next-meal {
          font-weight: bold;
          color: #408558;
        }

        &:last-of-type {
          border-bottom: none;
        }

        .date-and-title {
          padding-right: 8px;
        }

        .delete-meal {
          cursor: pointer;
          height: 16px;
          width: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: black;

          svg {
            height: 24px;
            width: 24px;
          }
        }
      }
    }
  }
</style>