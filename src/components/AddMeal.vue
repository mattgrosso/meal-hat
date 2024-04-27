<template>
  <div class="add-meal">
    <Header :headerText="headerText"/>
    <div class="add-meal-body p-3">
      <div class="row md-col-6 mx-auto g-2 mb-3">
        <div class="form-floating col-9" data-step="1">
          <input type="text" class="form-control" id="recipe-title" v-model="name">
          <label for="recipe-title">Name</label>
        </div>
        <div class="form-floating col-3" data-step="2">
          <input type="number" class="form-control" id="recipe-title" v-model="minDaysBetween">
          <label for="recipe-title">Frequency</label>
        </div>
      </div>
      <h2>Ingredients</h2>
      <div
        class="row md-col-6 mx-auto g-2 mb-3"
        v-for="(ingredient, index) in ingredients"
        :key="index"
        data-step="3"
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
        <button type="button" class="btn btn-primary mx-3" @click="submitMeal" data-step="4">{{ submitButtonText }}</button>
      </div>
    </div>
    <span class="start-tour-button" @click="this.startTour()">
      <i class="bi bi-question-circle"/>
    </span>
  </div>
</template>

<script>
import { v4 as uuidv4 } from 'uuid';
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
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
      if (!this.$store.state.groceryItems) {
        return [];
      } else {
        return Object.keys(this.$store.state.groceryItems).map((key) => this.$store.state.groceryItems[key]);
      }
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
        title: this.headerText,
        text: 'This page is for adding/editing meals in the hat. Let me show you around.',
        buttons: [
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Meal Name',
        text: 'Type the name of the meal here (or the restaurant if you\'re adding a takeout meal).',
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
        title: 'Frequency',
        text: 'Add a number of days here that will be the minimum number of days the hat will wait before it can suggest the meal again.',
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
        title: 'Add Ingredients',
        text: 'Here you can add the ingredients you need to make the meal.<br>You can add units (like cups or bags).<br>You can add more lines if you need to.<br>If it\'s a takeout meal, you can leave these blank.',
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
        title: 'Add the Meal',
        text: 'Click here to add the meal to your hat. If you\'re editing a meal, this will save your changes.',
        attachTo: {
          element: '[data-step="4"]',
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
        title: 'All done!',
        text: 'I hope that helped. Enjoy!',
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
}
</script>

<style lang="scss">
  .add-meal {
    .add-meal-body {
      max-width: 600px;
      margin: 0 auto;

      .ctas {
        display: flex;
        justify-content: center;
      }
    }
  }
</style>