<template>
  <div class="show-meals">
    <Header headerText="Show Meals"/>
    <div class="meals d-flex flex-wrap justify-content-start col-12">
      <div v-for="(meal, index) in meals" :key="index" class="meal col-12 md-col-4 p-3">
        <div class="card">
          <div class="card-body">
            <h5 class="card-title">{{meal.name}}</h5>
            <p class="card-text">Days before repeating: {{meal.minDaysBetween}}</p>
            <ul class="list-group list-group-flush border my-3">
              <li v-for="(ingredient, index) in meal.ingredients" :key="index" class="list-group-item text-start col-12">
                {{ingredient.name}}
              </li>
            </ul>
            <button class="btn btn-warning mx-2" @click="removeMeal(meal)">
              Remove Meal
            </button>
            <button class="btn btn-primary mx-2" @click="editMeal(meal)">
              Edit Meal
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Header from '@/components/Header.vue';

export default {
  name: 'ShowMeals',
  components: {
    Header
  },
  computed: {
    meals () {
      return this.$store.state.meals;
    }
  },
  methods: {
    editMeal (meal) {
      this.$router.push({
        name: 'EditMeal',
        params: {
          id: meal.id
        }
      });
    },
    removeMeal (meal) {
      const dbEntry = {
        path: `meals/${meal.id}`,
        value: null
      }

      this.$store.dispatch('updateDBValue', dbEntry);
    }
  },
}
</script>

<style lang="scss">
  .show-meals {
    @media screen and (min-width: 768px) {
      max-width: 80%;
      margin: 0 auto;
    }
  }
</style>
