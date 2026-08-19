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
import { defineAsyncComponent } from 'vue';
// Shepherd is loaded ON DEMAND, inside startTour().
//
// It was a static import here and in five other components, so the tour library
// and its stylesheet were downloaded by every visit — to power a "?" button most
// visits never press.
import Header from '@/components/Header.vue';
import Modal from '@/components/Modal.vue';
import { toISODate, fromISODate, todayISO, isUpcoming } from '@/store/schedule';

export default {
  name: 'ShowMeals',
  components: {
    Header,
    Modal,
    // v-calendar, loaded only when this screen is. It used to be registered
    // globally in main.js, so every visit paid for it whether or not a date
    // picker was ever rendered.
    VDatePicker: defineAsyncComponent(async () => {
      const [{ DatePicker }] = await Promise.all([
        import(/* webpackChunkName: "calendar" */ 'v-calendar'),
        import(/* webpackChunkName: "calendar" */ 'v-calendar/style.css')
      ]);
      return DatePicker;
    })
  },
  data () {
    return {
      showScheduleModal: false,
      mealToSchedule: null,
      // A Date at LOCAL midnight, not an ISO string: v-calendar reads a bare
      // 'YYYY-MM-DD' as UTC midnight and highlights the previous day.
      dateToSchedule: fromISODate(todayISO())
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
    catalogAsArray () {
      return Object.values(this.$store.state.groceryCatalog || {});
    },
    datesWithMeals () {
      return (this.$store.state.drawnMealsWithHistory || [])
        .map((drawnMeal) => fromISODate(drawnMeal.assignedDate))
        .filter(Boolean);
    },
    attributes () {
      if (!this.$store.state.drawnMeals || !this.$store.state.drawnMeals.length) {
        return [];
      }

      const assignedMeals = (this.$store.state.drawnMealsWithHistory || [])
        .map((meal) => {
          const date = fromISODate(meal.assignedDate);
          if (!date) return null;

          return {
            highlight: {
              color: 'green',
              fillMode: 'outline',
            },
            dates: [date]
          };
        })
        .filter(Boolean);

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
    async scheduleMeal () {
      const meal = this.mealToSchedule;
      const isoDate = toISODate(this.dateToSchedule);
      if (!meal || !isoDate) return;

      // Same atomic path the bulk draw uses. This used to be a hand-copied
      // duplicate of DrawMeals' drawnDates bookkeeping — two copies that had to
      // be kept in step by hand, which is how they came to disagree.
      await this.$store.dispatch('applyDraw', { assignments: [{ meal, isoDate }] });

      // Regenerate shopping list from newly scheduled meal
      await this.$store.dispatch('generateShoppingListFromMeals');

      this.showScheduleModal = false;
      this.$router.push('/');
      this.$emit('showToast', {
        delay: 3000,
        message: `Scheduled ${meal.name} for ${new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(fromISODate(isoDate))}`
      });
    },
    getGroceryItems (meal) {
      return meal.ingredients
        .map((ingredient) => this.catalogAsArray.find((groceryItem) => groceryItem.id === ingredient.groceryItemId))
        .filter(Boolean); // drop any ingredient whose grocery entry can't be resolved
    },
    async startTour () {
      const [{ default: Shepherd }] = await Promise.all([
        import(/* webpackChunkName: "tour" */ 'shepherd.js'),
        import(/* webpackChunkName: "tour" */ 'shepherd.js/dist/css/shepherd.css')
      ]);

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
    // These take whatever getLastDrawnDate returns, which is now an ISO date
    // string rather than an epoch number. fromISODate matters here: new Date on
    // a bare 'YYYY-MM-DD' is UTC midnight, i.e. the previous day locally, so
    // every "last drawn" label would have read a day early.
    formatLastDrawnDate (lastDrawn) {
      const date = fromISODate(lastDrawn);
      if (!date) return '';

      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric'
      }).format(date);
    },
    daysSinceLastDrawn (lastDrawn) {
      const lastDrawnDate = fromISODate(lastDrawn);
      if (!lastDrawnDate) return 0;

      // Whole calendar days, so the answer doesn't change as the clock moves
      // through the day.
      const today = fromISODate(todayISO());
      return Math.abs(Math.round((today - lastDrawnDate) / (1000 * 60 * 60 * 24)));
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
    isInThePast (date) {
      // isUpcoming counts today as still to come, so its negation is exactly
      // "strictly before today" — the comparison this used to hand-roll.
      return !isUpcoming(date);
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
