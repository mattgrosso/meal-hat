<template>
  <div class="shopping-list">
    <h1>Shopping List</h1>
    <div class="shopping-list-body p-3">
      <ul>
        <li v-for="(ingredient, index) in compiledIngredientsList" :key="index" class="d-flex flex-wrap">
          <p class="m-0 col-12">
            <span class="fw-bold me-3">{{ ingredient.name }}</span>
            <span>{{ ingredient.quantity }}</span>
            <span>&nbsp;{{ pluralizedUnits(ingredient) }}</span>
          </p>
          <div class="ingredient-checkboxes d-flex flex-wrap">
            <button v-for="n in ingredient.quantity" :key="n" class="btn btn-primary" @click="ingredientChecked(ingredient)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check2" viewBox="0 0 16 16">
                <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
              </svg>
            </button>
          </div>
        </li>
      </ul>
      <button class="btn btn-warning" @click="resetShoppingList">
        Reset List
      </button>
    </div>
  </div>
</template>

<script>
import pluralize from 'pluralize';

export default {
  name: 'ShoppingList',
  data () {
    return {
      compiledIngredientsList: null
    }
  },
  mounted () {
    this.compiledIngredientsList = this.$store.state.shoppingList;
  },
  watch: {
    shoppingList () {
      this.compiledIngredientsList = this.$store.state.shoppingList;
    }
  },
  computed: {
    shoppingList () {
      return this.$store.state.shoppingList;
    },
    drawnMeals () {
      if (!this.$store.state.drawnMeals || !this.$store.state.drawnMeals.length) {
        return [];
      } else {
        return this.$store.state.drawnMeals.map((drawnMeal) => {
          return {
            ...drawnMeal,
            meal: this.$store.getters.getMeal(drawnMeal.mealId)
          }
        });
      }
    }
  },
  methods: {
    resetShoppingList () {
      const ingredientsList = [];

      if (this.drawnMeals && this.drawnMeals.length) {
        this.drawnMeals.forEach((drawnMeal) => {
          if (!drawnMeal.meal || !drawnMeal.meal.ingredients || !drawnMeal.meal.ingredients.length) {
            return;
          }

          drawnMeal.meal.ingredients.forEach((ingredient) => {
            const existingIngredient = ingredientsList.find((existingIngredient) => {
              return existingIngredient.name === ingredient.name;
            });

            if (existingIngredient) {
              existingIngredient.quantity += ingredient.quantity;
            } else {
              ingredientsList.push({
                ...ingredient
              });
            }
          });
        });
      }

      this.compiledIngredientsList = ingredientsList;
      this.updateShoppingList();
    },
    ingredientChecked (ingredient) {
      ingredient.quantity -= 1;

      if (ingredient.quantity < 1) {
        this.compiledIngredientsList = this.compiledIngredientsList.filter((ingredient) => {
          return ingredient.quantity > 0;
        });
      }

      this.updateShoppingList();
    },
    updateShoppingList () {
      const noEmpties = this.compiledIngredientsList.filter((ingredient) => {
        return ingredient.quantity > 0;
      });

      const dbEntry = {
        path: `shopping-list`,
        value: noEmpties
      }

      this.$nextTick(() => {
        this.$store.dispatch('updateDBValue', dbEntry);
      });
    },
    pluralizedUnits (ingredient) {
      if (ingredient.quantity < 2) {
        return pluralize.singular(ingredient.units);
      } else {
        return pluralize.plural(ingredient.units);
      }
    }
  },
};
</script>

<style lang="scss">
  .shopping-list {
    max-width: 600px;
    margin: 0 auto 100px;
    text-align: center;

    ul {
      list-style: none;
      border: 1px solid black;
      padding: 0 32px;

      li {
        border-bottom: 1px solid black;
        padding: 16px 0;
        text-align: left;
        font-size: 1.25rem;

        &:last-of-type {
          border-bottom: none;
        }

        .ingredient-checkboxes {
          button {
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 6px;
            box-shadow: 0 0 4px rgba(0,0,0,0.25);
            margin: 16px 4px 0;

            svg {
              width: 16px;
              height: 16px;
            }
          }
        }

      }
    }
  }
</style>