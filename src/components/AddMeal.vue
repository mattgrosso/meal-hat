<template>
  <div class="add-meal">
    <h1 class="mb-5">Add Meal</h1>
    <div class="form-floating mb-3 col-6 mx-auto">
      <input type="text" class="form-control" id="recipe-title" v-model="name">
      <label for="recipe-title">Name</label>
    </div>
    <h2>Shopping List</h2>
    <div
      class="row col-6 mx-auto g-2 mb-3"
      v-for="(ingredient, index) in ingredients"
      :key="index"
    >
      <div class="col-9">
        <div class="form-floating">
          <input type="text" class="form-control " :id="`ingredient-${index}-name`" v-model="ingredient.name" :ref="`ingredient-${index}-name`">
          <label :for="`ingredient-${index}-name`">Ingredient #{{index + 1}}</label>
        </div>
      </div>
      <div class="col-3">
        <div class="form-floating">
          <input type="text" class="form-control " :id="`ingredient-${index}-quantity`" v-model="ingredient.quantity">
          <label :for="`ingredient-${index}-quantity`">Quantity</label>
        </div>
      </div>
    </div>
  </div>
  <button type="button" class="btn btn-info" @click="addIngredient">Add More</button>
  <button type="button" class="btn btn-success mx-3" @click="submitMeal">Add To Hat</button>
</template>

<script>
export default {
  data () {
    return {
      name: null,
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
  methods: {
    addIngredient() {
      this.ingredients.push({
        name: null,
        quantity: null
      });

      this.$nextTick(() => {
        this.$refs[`ingredient-${this.ingredients.length - 1}-name`][0].focus();
      });
    },
    async submitMeal() {
      const meal = {
        name: this.name,
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

</style>
