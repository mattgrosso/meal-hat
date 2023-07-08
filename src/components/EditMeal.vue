<template>
  <div class="edit-meal">
    <h1 class="mb-5">Edit Meal</h1>
    <div class="edit-meal-body p-3">
      <div class="row md-col-6 mx-auto g-2 mb-3">
        <div class="form-floating col-9">
          <input type="text" class="form-control" id="recipe-title" v-model="name">
          <label for="recipe-title">Name</label>
        </div>
        <div class="form-floating col-3">
          <input type="number" class="form-control" id="recipe-title" v-model="minDaysBetween">
          <label for="recipe-title">Frequency</label>
        </div>
      </div>
      <h2>Shopping List</h2>
      <div
        class="row md-col-6 mx-auto g-2 mb-3"
        v-for="(ingredient, index) in ingredients"
        :key="index"
      >
        <div class="form-floating col-7">
          <input type="text" class="form-control " :id="`ingredient-${index}-name`" v-model="ingredient.name" :ref="`ingredient-${index}-name`">
          <label :for="`ingredient-${index}-name`">Ingredient #{{index + 1}}</label>
        </div>
        <div class="form-floating col-2">
          <input type="number" class="form-control " :id="`ingredient-${index}-quantity`" v-model="ingredient.quantity">
          <label :for="`ingredient-${index}-quantity`">#</label>
        </div>
        <div class="form-floating col-3">
          <input type="text" class="form-control " :id="`ingredient-${index}-units`" v-model="ingredient.units">
          <label :for="`ingredient-${index}-units`">Units</label>
        </div>
      </div>
      <div class="ctas p-3">
        <button type="button" class="btn btn-tertiary" @click="addIngredient">Add More Lines</button>
        <button type="button" class="btn btn-primary mx-3" @click="submitMeal">Edit Meal</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'EditMeals',
  data () {
    return {
      name: null,
      minDaysBetween: 7,
      ingredients: [
        {
          name: null,
          quantity: null
        },
        {
          name: null,
          quantity: null
        },
        {
          name: null,
          quantity: null
        },
        {
          name: null,
          quantity: null
        },
      ],
    }
  },
  mounted () {
    const meal = this.$store.state.meals.find(meal => meal.id === this.$route.params.id);
    this.name = meal.name;
    this.minDaysBetween = meal.minDaysBetween;
    this.ingredients = meal.ingredients;
  },
  methods: {
    addIngredient () {
      this.ingredients.push({
        name: null,
        quantity: null
      });

      this.$nextTick(() => {
        this.$refs[`ingredient-${this.ingredients.length - 1}-name`][0].focus();
      });
    },
    async submitMeal () {
      const meal = {
        id: this.$route.params.id,
        name: this.name,
        minDaysBetween: this.minDaysBetween,
        ingredients: this.ingredients
      };

      const dbEntry = {
        path: `meals/${this.$route.params.id}`,
        value: meal
      }

      this.$store.dispatch('updateDBValue', dbEntry);
      this.$router.push('/');
    }
  },
}
</script>

<style lang="scss">
  .edit-meal {
    .edit-meal-body {
      .ctas {
        display: flex;
        justify-content: center;
      }
    }
  }
</style>
