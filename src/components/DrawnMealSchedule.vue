<template>
  <div class="drawn-meals-schedule my-5">
    <h3>Drawn Meals</h3>
    <ul>
      <li v-for="(drawnMeal, index) in drawnMeals" :key="index">
        {{ drawnMeal.assignedDate }} - {{ drawnMeal.meal.name }}
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  computed: {
    drawnMeals () {
      return this.$store.state.drawnMeals;
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
        padding: 16px;
        text-align: left;
        font-size: 1.25rem;

        &:last-of-type {
          border-bottom: none;
        }
      }
    }
  }
</style>