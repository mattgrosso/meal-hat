<template>
  <div class="add-meal">
    <Header :headerText="headerText"/>
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
        <button type="button" class="btn btn-primary mx-3" @click="submitMeal">{{ submitButtonText }}</button>
      </div>
    </div>
  </div>
</template>

<script>
import { v4 as uuidv4 } from 'uuid';
import Header from '@/components/Header.vue';

export default {
  name: 'AddMeals',
  components: {
    Header
  },
  data () {
    return {
      mealId: null,
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
  computed: {
    groceryItemsAsArray () {
      return Object.keys(this.$store.state.groceryItems).map((key) => this.$store.state.groceryItems[key]);
    },
    headerText () {
      return this.mealId ? 'Edit Meal' : 'Add Meal';
    },
    submitButtonText () {
      return this.mealId ? 'Save Changes' : 'Add Meal To Hat';
    }
  },
  created () {
    this.mealId = this.$route.params.id;

    this.$watch(
      () => this.$store.state.meals,
      (newMeals) => {
        if (newMeals && this.mealId) {
          const meal = newMeals.find(meal => meal.id === this.mealId);

          if (meal) {
            this.id = meal.id;
            this.name = meal.name;
            this.minDaysBetween = meal.minDaysBetween;
            if (meal.ingredients) {
              this.ingredients = meal.ingredients.map((ingredient) => {
                const groceryItem = this.groceryItemsAsArray.find((item) => item.id === ingredient.groceryItemId);

                if (groceryItem) {
                  return {
                    name: groceryItem.name,
                    quantity: ingredient.quantity,
                    units: groceryItem.units
                  };
                } else {
                  return null;
                }
              }).filter((ingredient) => ingredient);
            }
          }
        }
      },
      { immediate: true }
    );
  },
  methods: {
    addIngredient () {
      this.ingredients.push({
        aisle: 0,
        name: null,
        quantity: null
      });

      this.$nextTick(() => {
        this.$refs[`ingredient-${this.ingredients.length - 1}-name`][0].focus();
      });
    },
    addNewIngredientsToGroceryItems () {
      this.ingredients.forEach((ingredient) => {
        const existingIngredient = this.groceryItemsAsArray.find((item) => item.name === ingredient.name);

        if (ingredient.name && !existingIngredient) {
          const newId = uuidv4();

          const newIngredient = {
            id: newId,
            aisle: 0,
            name: ingredient.name,
            units: ingredient.units
          };

          const dbEntry = {
            path: `grocery-items/${newId}`,
            value: newIngredient
          }

          this.$store.dispatch('updateDBValue', dbEntry);
        }
      });
    },
    parseIngredients () {
      return this.ingredients.map((ingredient) => {
        const groceryItem = this.groceryItemsAsArray.find((item) => item.name === ingredient.name);

        if (groceryItem) {
          return {
            groceryItemId: groceryItem.id,
            quantity: ingredient.quantity
          };
        } else {
          return null;
        }
      }).filter((ingredient) => ingredient);
    },
    async submitMeal () {
      this.addNewIngredientsToGroceryItems();

      const meal = {
        name: this.name,
        minDaysBetween: this.minDaysBetween,
        ingredients: this.parseIngredients()
      };

      if (this.mealId) {
        const updatedDbEntry = {
          path: `meals/${this.mealId}`,
          value: {
            ...meal,
            id: this.mealId
          }
        };

        this.$store.dispatch('updateDBValue', updatedDbEntry);
      } else {
        const dbEntry = {
          path: "meals",
          value: meal
        };

        this.$store.dispatch('setDBValue', dbEntry);
      }

      this.$router.push('/');
    }
  },
}
</script>

<style lang="scss">
  .add-meal {
    .add-meal-body {
      .ctas {
        display: flex;
        justify-content: center;
      }
    }
  }
</style>