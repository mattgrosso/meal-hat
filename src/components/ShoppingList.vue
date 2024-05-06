<template>
  <div class="shopping-list">
    <Header headerText="Shopping List"/>
    <div class="shopping-list-body p-3">
      <ul>
        <li v-for="(ingredient, index) in sortedShoppingList" :key="index" class="d-flex flex-wrap" :data-step="index === 0 ? '1' : undefined">
          <div class="m-0 col-12 d-flex justify-content-between align-items-center">
            <div class="col">
              <span class="fw-bold me-3">{{ ingredient.name }}</span>
              <span>{{ ingredient.quantity }}</span>
              <span v-if="ingredient.units">&nbsp;{{ pluralizedUnits(ingredient) }}</span>
            </div>
            <div class="col-2" :data-step="index === 0 ? '2' : undefined">
              <input type="number" class="form-control" id="aisle-input" v-model.number.lazy="ingredient.aisle" @blur="updateGroceryItemAisle(ingredient)" placeholder="##">
            </div>
          </div>
          <div class="ingredient-checkboxes d-flex flex-wrap" :data-step="index === 0 ? '3' : undefined">
            <button v-for="n in parsedIngredientQuantity(ingredient)" :key="n" class="btn btn-primary" @click="ingredientChecked(ingredient, n)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check2" viewBox="0 0 16 16">
                <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
              </svg>
            </button>
          </div>
        </li>
      </ul>
    </div>
    <span class="start-tour-button" @click="this.startTour()">
      <i class="bi bi-question-circle"/>
    </span>
  </div>
</template>

<script>
import pluralize from 'pluralize';
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import Header from '@/components/Header.vue';

export default {
  name: 'ShoppingList',
  components: {
    Header
  },
  computed: {
    sortedShoppingList () {
      return [...this.$store.getters.unpurchasedIngredients].sort((a, b) => {
        if (!a.aisle && b.aisle) {
          return 1;
        } else if (a.aisle && !b.aisle) {
          return -1;
        } else if (!a.aisle && !b.aisle) {
          return 0;
        } else if (a.aisle < b.aisle) {
          return -1;
        } else if (a.aisle > b.aisle) {
          return 1;
        } else {
          return 0;
        }
      });
    }
  },
  methods: {
    ingredientChecked (ingredient, n) {
      const quantityToRemove = ingredient.quantity - n + 1;
      const value = {
        ingredientId: ingredient.id,
        quantity: quantityToRemove
      }

      this.$store.dispatch('purchaseIngredient', value);
    },
    updateGroceryItemAisle (ingredient) {
      const isGroceryItem = Object.prototype.hasOwnProperty.call(this.$store.state.groceryItems, ingredient.id);
      const isNonMealGroceryItem = Object.prototype.hasOwnProperty.call(this.$store.state.nonMealGroceryItems, ingredient.id);

      let dbPath;
      if (isGroceryItem) {
        dbPath = `grocery-items/${ingredient.id}/aisle`;
      } else if (isNonMealGroceryItem) {
        dbPath = `non-meal-grocery-items/${ingredient.id}/aisle`;
      } else {
        console.error('Ingredient not found in groceryItems or nonMealGroceryItems');
        return;
      }

      const dbEntry = {
        path: dbPath,
        value: ingredient.aisle
      };

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
    },
    parsedIngredientQuantity (ingredient) {
      if (typeof ingredient.quantity !== 'number') {
        return 1;
      } else if (ingredient.quantity < 1 && ingredient.quantity > 0) {
        return 1;
      } else {
        return ingredient.quantity;
      }
    },
    startTour () {
      const tour = new Shepherd.Tour({
        defaultStepOptions: {
          classes: 'mx-auto col-9',
          cancelIcon: {
            enabled: true
          }
        },
        useModalOverlay: true
      });

      tour.addStep({
        title: 'Shopping List',
        text: 'Once you have drawn some meals can compare this list to what you have in your kitchen.<br>Check off what you already have and the remaining items will be your grocery list.',
        buttons: [
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Ingredient Details',
        text: 'This is the name and quantity of the ingredient.<br>You can also see the aisle number here.',
        attachTo: {
          element: '[data-step="1"]',
          on: 'bottom'
        },
        buttons: [
          {
            text: 'Back',
            action: tour.back,
            classes: 'btn-secondary btn btn-sm'
          },
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Aisle Number',
        text: 'You can adjust the grocery aisle number here.<br>Your grocery list is sorted by aisle number so it\'s easy to make your way through the store.',
        attachTo: {
          element: '[data-step="2"]',
          on: 'bottom'
        },
        buttons: [
          {
            text: 'Back',
            action: tour.back,
            classes: 'btn-secondary btn btn-sm'
          },
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Check Marks',
        text: 'Click these check marks to mark off the ingredients as you find them in the store.<br>Each one you click will remove that one and each one to its right.<br>In this way you can quickly remove however many you need.',
        attachTo: {
          element: '[data-step="3"]',
          on: 'bottom'
        },
        buttons: [
          {
            text: 'Back',
            action: tour.back,
            classes: 'btn-secondary btn btn-sm'
          },
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'All Set!',
        text: 'Hopefully that will get you started.',
        buttons: [
          {
            text: 'Done',
            action: tour.complete,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.start();
    },
  },
};
</script>

<style lang="scss">
  .shopping-list {
    text-align: center;

    .shopping-list-body {
      max-width: 600px;
      margin: 0 auto 100px;

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
            border-bottom: 0;
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

  }
</style>