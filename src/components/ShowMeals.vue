<template>
  <div class="show-meals">
    <Header headerText="Show Meals"/>
    <div class="meals d-flex flex-wrap justify-content-start col-12">
      <div v-for="(meal, index) in meals" :key="index" class="meal col-12 md-col-4 p-3" data-step="1">
        <div class="card">
          <div class="card-body">
            <h5 class="card-title">{{meal.name}}</h5>
            <p class="card-text">Days before repeating: {{meal.minDaysBetween}}</p>
            <ul v-if="meal.ingredients" class="list-group list-group-flush border my-3">
              <li v-for="(ingredient, index) in getGroceryItems(meal)" :key="index" class="list-group-item text-start col-12">
                {{ingredient.name}}
              </li>
            </ul>
            <button class="btn btn-warning mx-2" @click="removeMeal(meal)" :data-step="index === 0 ? '2' : undefined">
              Remove Meal
            </button>
            <button class="btn btn-primary mx-2" @click="editMeal(meal)" :data-step="index === 0 ? '3' : undefined">
              Edit Meal
            </button>
          </div>
        </div>
      </div>
    </div>
    <span class="start-tour-button" @click="this.startTour()">
      <i class="bi bi-question-circle"/>
    </span>
  </div>
</template>

<script>
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import Header from '@/components/Header.vue';

export default {
  name: 'ShowMeals',
  components: {
    Header
  },
  computed: {
    meals () {
      return this.$store.state.meals;
    },
    groceryItemsAsArray () {
      if (!this.$store.state.groceryItems) {
        return [];
      } else {
        return Object.keys(this.$store.state.groceryItems).map((key) => this.$store.state.groceryItems[key]);
      }
    }
  },
  methods: {
    editMeal (meal) {
      this.$router.push({
        name: 'AddMeal',
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
    },
    getGroceryItems (meal) {
      return meal.ingredients.map((ingredient) => {
        return this.groceryItemsAsArray.find((groceryItem) => groceryItem.id === ingredient.groceryItemId);
      });
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
        title: 'Meals in the Hat',
        text: 'This page shows you all of the meals that you have in your hat. Let me show you around real quick.',
        buttons: [
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Meal List',
        text: 'Each meal is shown just like this one. You can see the minimum days between repeats and the ingredients.',
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
        title: 'Remove Meal',
        text: 'Click here to remove a meal from the hat.',
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
        title: 'Edit Meal',
        text: 'Click here to edit a meal in the hat.',
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
        title: 'That\'s it!',
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
  .show-meals {
    @media screen and (min-width: 768px) {
      max-width: 80%;
      margin: 0 auto;
    }
  }
</style>
