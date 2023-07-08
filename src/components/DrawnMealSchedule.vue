<template>
  <div class="drawn-meals-schedule my-5 col-8">
    <h3>Drawn Meals</h3>
    <ul>
      <li v-for="(drawnMeal, index) in drawnMeals" :key="index">
        <span>
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
  </div>
</template>

<script>
export default {
  name: 'DrawnMealSchedule',
  computed: {
    drawnMeals () {
      if (!this.$store.state.drawnMeals || !this.$store.state.drawnMeals.length) {
        return [];
      } else {
        return this.$store.state.drawnMeals.map((drawnMeal) => {
          return {
            ...drawnMeal,
            meal: this.$store.getters.getMeal(drawnMeal.mealId)
          }
        }).filter((drawnMeal) => {
          return drawnMeal.meal;
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
    }
  },
};
</script>

<style lang="scss">
  .drawn-meals-schedule {
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

        &:last-of-type {
          border-bottom: none;
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