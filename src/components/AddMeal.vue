<template>
  <div class="add-meal">
    <h1 @click="$router.push('/')" class="mb-5">Add Meal</h1>
    <div class="add-meal-body p-3">
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
      <h2>Ingredients</h2>
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
        <button type="button" class="btn btn-primary mx-3" @click="submitMeal">Add Meal To Hat</button>
      </div>
    </div>
    </div>
</template>

<script>
export default {
  name: 'AddMeals',
  data () {
    return {
      name: null,
      minDaysBetween: 7,
      ingredients: [
        {
          name: null,
          quantity: null,
          units: null
        },
        {
          name: null,
          quantity: null,
          units: null
        },
        {
          name: null,
          quantity: null,
          units: null
        },
        {
          name: null,
          quantity: null,
          units: null
        },
      ],
    }
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
        name: this.name,
        minDaysBetween: this.minDaysBetween,
        ingredients: this.ingredients
      };

      const dbEntry = {
        path: "meals",
        value: meal
      }

      this.$store.dispatch('setDBValue', dbEntry);
      this.$router.push('/');
    }
  },
}
</script>

<style lang="scss">
  .add-meal {
    h1 {
      cursor: pointer;
    }
    
    .add-meal-body {
      .ctas {
        display: flex;
        justify-content: center;
      }
    }
  }
</style>
