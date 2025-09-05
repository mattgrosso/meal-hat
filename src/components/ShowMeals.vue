<template>
  <div class="show-meals">
    <Header headerText="Show Meals"/>
    <div class="show-meals-body d-flex flex-wrap justify-content-start col-12">
      <div v-for="(meal, index) in meals" :key="index" class="meal col-12 md-col-4 p-3" data-step="1">
        <div class="card">
          <div class="card-body">
            <h5 class="card-title">{{meal.name}}</h5>
            <p class="card-text">Days before repeating: {{meal.minDaysBetween}}</p>
            <p class="card-text text-muted" v-if="getLastDrawnDate(meal)">
              Last drawn: {{formatLastDrawnDate(getLastDrawnDate(meal))}}
              <span v-if="isInThePast(getLastDrawnDate(meal))">({{daysSinceLastDrawn(getLastDrawnDate(meal))}} days)</span>
            </p>
            <p class="card-text text-muted" v-else>
              Last drawn: Never
            </p>
            <ul v-if="meal.ingredients" class="list-group list-group-flush border my-3">
              <li v-for="(ingredient, index) in getGroceryItems(meal)" :key="index" class="list-group-item text-start col-12">
                {{ingredient.name}}
              </li>
            </ul>
            <button class="btn btn-warning mx-2" @click="removeMeal(meal)" :data-step="index === 0 ? '2' : undefined">
              Remove
            </button>
            <button class="btn btn-primary mx-2" @click="editMeal(meal)" :data-step="index === 0 ? '3' : undefined">
              Edit
            </button>
            <button class="btn btn-primary mx-2" @click="pickDateForMeal(meal)" :data-step="index === 0 ? '4' : undefined">
              Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
    <Modal
      :showModal="showScheduleModal"
      title="Pick a Date"
      primaryButtonText="Schedule Meal"
      secondaryButtonText="Cancel"
      :closeModalCallback="hideScheduleModal"
      :primaryButtonCallback="scheduleMeal"
      :secondaryButtonCallback="hideScheduleModal"
    >
      <VDatePicker
        v-model="dateToSchedule"
        :attributes='attributes'
        :disabled-dates="datesWithMeals"
        expanded
      />
    </Modal>
    <span class="start-tour-button" @click="this.startTour()">
      <i class="bi bi-question-circle"/>
    </span>
  </div>
</template>

<script>
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import Header from '@/components/Header.vue';
import Modal from '@/components/Modal.vue';

export default {
  name: 'ShowMeals',
  components: {
    Header,
    Modal
  },
  data () {
    return {
      showScheduleModal: false,
      mealToSchedule: null,
      dateToSchedule: new Date().toISOString().slice(0, 10)
    }
  },
  computed: {
    meals () {
      if (!this.$store.state.meals) {
        return [];
      }
      return Object.values(this.$store.state.meals)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    groceryItemsAsArray () {
      if (!this.$store.state.groceryItems) {
        return [];
      } else {
        return Object.keys(this.$store.state.groceryItems).map((key) => this.$store.state.groceryItems[key]);
      }
    },
    datesWithMeals () {
      if (!this.$store.state.drawnMealsWithHistory) {
        return [];
      } else {
        return this.$store.state.drawnMealsWithHistory.map((drawnMeal) => {
          return new Date(drawnMeal.assignedDate);
        });
      }
    },
    attributes () {
      if (!this.$store.state.drawnMeals || !this.$store.state.drawnMeals.length) {
        return [];
      }

      const assignedMeals = this.$store.state.drawnMealsWithHistory.map((meal) => {
        return {
          highlight: {
            color: 'green',
            fillMode: 'outline',
          },
          dates: [new Date(meal.assignedDate)]
        }
      });

      return [
        ...assignedMeals,
        {
          key: 'today',
          highlight: {
            fillMode: 'light',
          },
          dates: [new Date()]
        }
      ]
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
    pickDateForMeal (meal) {
      this.mealToSchedule = meal;
      this.showScheduleModal = true;
    },
    hideScheduleModal () {
      this.showScheduleModal = false;
    },
    scheduleMeal () {
      const meal = this.mealToSchedule;
      const date = new Date(this.dateToSchedule);

      const dbEntry = {
        path: "drawnMeals",
        value: {
          mealId: meal.id,
          assignedDate: date.toDateString()
        }
      }

      this.$store.dispatch('setDBValue', dbEntry);

      // Update meal with new drawnDates array system
      let currentDrawnDates = meal.drawnDates || [];
      
      // Migration: if no drawnDates but has lastDrawn, initialize with that history
      if (currentDrawnDates.length === 0 && meal.lastDrawn) {
        currentDrawnDates = [meal.lastDrawn];
      }
      
      const newTimestamp = date.getTime();
      
      // Add new date to front of array, keep old dates for history
      const updatedDrawnDates = [newTimestamp, ...currentDrawnDates.filter(date => date !== newTimestamp)];
      
      const drawnMealForUpdate = {
        path: `meals/${meal.id}`,
        value: {
          ...meal,
          drawnDates: updatedDrawnDates,
          // Keep lastDrawn for backward compatibility during transition
          lastDrawn: newTimestamp
        }
      }

      this.$store.dispatch('updateDBValue', drawnMealForUpdate);

      this.$store.dispatch('updateDBValue', {
        path: 'purchased-ingredients',
        value: { placeholder: 'placeholder' }
      });

      this.$router.push('/');
      this.$emit('showToast', {
        delay: 3000,
        message: `Scheduled ${meal.name} for ${new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}`
      });
      this.showScheduleModal = false
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
    formatLastDrawnDate (lastDrawnTimestamp) {
      const date = new Date(lastDrawnTimestamp);
      return new Intl.DateTimeFormat('en-US', { 
        month: 'short', 
        day: 'numeric'
      }).format(date);
    },
    daysSinceLastDrawn (lastDrawnTimestamp) {
      const lastDrawnDate = new Date(lastDrawnTimestamp);
      const today = new Date();
      const diffTime = Math.abs(today - lastDrawnDate);
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    },
    getLastDrawnDate (meal) {
      // New system: use drawnDates array (most recent first)
      if (meal.drawnDates && meal.drawnDates.length > 0) {
        return meal.drawnDates[0];
      }
      // Fallback to old system
      if (meal.lastDrawn) {
        return meal.lastDrawn;
      }
      return null;
    },
    isInThePast (timestamp) {
      const drawnDate = new Date(timestamp);
      const today = new Date();
      
      // Compare dates (not times) to handle timezone issues
      const drawnDateOnly = new Date(drawnDate.getFullYear(), drawnDate.getMonth(), drawnDate.getDate());
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      
      return drawnDateOnly < todayOnly;
    },
  },
}
</script>

<style lang="scss">
  .show-meals {
    .show-meals-body {
      max-width: 600px;
      margin: 0 auto;
    }
  }
</style>
