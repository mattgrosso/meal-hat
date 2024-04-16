<template>
  <div class="drawn-meals-schedule my-5 md-col-8">
    <h3>Drawn Meals</h3>
    <ul v-if="drawnMeals.length">
      <li v-for="(drawnMeal, index) in drawnMeals" :key="index" :class="{todaysMeal: todaysMeal(drawnMeal)}">
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
    todaysMeal (drawnMeal) {
      const now = new Date();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const evening = new Date();
      evening.setHours(19, 30, 0, 0); // 7:30 PM

      if (now >= evening) {
        // If current time is after 7:30 PM, set 'today' to tomorrow's date
        todayStart.setDate(todayStart.getDate() + 1);
        todayEnd.setDate(todayEnd.getDate() + 1);
      }

      const assignedDate = new Date(drawnMeal.assignedDate);
      return assignedDate >= todayStart && assignedDate <= todayEnd;
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
      border: 1px solid black;
      padding: 0 32px;

      li {
        border-bottom: 1px solid black;
        padding: 16px 0;
        text-align: left;
        font-size: 1.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;

        &.todaysMeal {
          font-weight: bold;
        }

        &:last-of-type {
          border-bottom: none;
        }

        .date-and-title {
          padding-right: 8px;
        }

        .delete-meal {
          cursor: pointer;
          height: 24px;
          width: 24px;
          display: flex;
          align-items: center;
          justify-content: center;

          svg {
            height: 24px;
            width: 24px;
          }
        }
      }
    }
  }
</style>