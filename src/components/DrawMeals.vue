<template>
  <div class="draw-meals">
    <Header headerText="Draw Meals"/>
    <div class="draw-meals-body p-3">
      <h3 class="my-2">Pick Days for drawing</h3>
      <VDatePicker
        v-model.range="dateRange"
        data-step="1"
        :attributes='attributes'
        :disabled-dates="datesWithMeals"
        expanded
      />
      <div v-if="hasDateRange" class="date-range my-3"  data-step="2">
        <div class="range">
          <span class="mx-2 fw-bold">{{ formattedStartDate }}</span>
          <span>to</span>
          <span class="mx-2 fw-bold">{{ formattedEndDate }}</span>
        </div>
        <button class="btn btn-primary my-3" @click="drawMeals" data-step="3">Draw Meals</button>
      </div>
      <div v-if="message" class="messages">{{ message }}</div>
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
  name: 'DrawMeals',
  components: {
    Header
  },
  data () {
    return {
      message: null,
      dateRange: {
        start: new Date().toISOString().slice(0, 10),
        end: new Date().toISOString().slice(0, 10)
      }
    }
  },
  computed: {
    hasDateRange () {
      return this.dateRange.start && this.dateRange.end;
    },
    formattedStartDate () {
      return this.dateRange.start ? new Date(this.dateRange.start).toDateString() : null;
    },
    formattedEndDate () {
      if (this.dateRange.end) {
        return new Date(this.dateRange.end).toDateString();
      } else if (this.dateRange.start) {
        return new Date(this.dateRange.start).toDateString();
      } else {
        return null;
      }
    },
    allDatesInRange () {
      const dates = [];
      const startDate = this.dateRange.start;
      const endDate = this.dateRange.end;
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return dates;
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
          popover: {
            label: this.getMeal(meal.mealId).name,
            visibility: 'click'
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
    drawMeals () {
      this.allDatesInRange.forEach(async (date) => {
        const randomMeal = this.getRandomMealForDate(date);

        if (!randomMeal) {
          this.message = `No meals available for ${date.toDateString()}`;
          return;
        }
        // TODO: If more than one copy of the same meal is drawn in one call of drawMeals,
        // we may have trouble because the DB entries might not update in time.

        const dbEntry = {
          path: "drawnMeals",
          value: {
            mealId: randomMeal.id,
            assignedDate: date.toDateString()
          }
        }

        this.$store.dispatch('setDBValue', dbEntry);

        const drawnMealForUpdate = {
          path: `meals/${randomMeal.id}`,
          value: {
            ...randomMeal,
            lastDrawn: date.getTime()
          }
        }

        this.$store.dispatch('updateDBValue', drawnMealForUpdate);

        this.$store.dispatch('updateDBValue', {
          path: 'purchased-ingredients',
          value: { placeholder: 'placeholder' }
        });

        this.$router.push('/');
      });
    },
    mealDrawnTooRecently (meal, date) {
      if (!meal.lastDrawn) {
        return false;
      }

      const lastDrawnNum = new Date(meal.lastDrawn).getTime();
      const dateNum = new Date(date).getTime();
      const daysSinceLastDrawn = Math.abs(Math.floor((dateNum - lastDrawnNum) / (1000 * 60 * 60 * 24)));
      return daysSinceLastDrawn < meal.minDaysBetween;
    },
    getRandomMealForDate (date) {
      const allMeals = this.$store.state.meals;
      if (typeof allMeals !== 'object') {
        return null;
      }
      const allMealsArray = Object.keys(allMeals).map((key) => allMeals[key]);
      const filteredMealsArray = allMealsArray.filter((meal) => {
        return !this.mealDrawnTooRecently(meal, date);
      });

      if (!filteredMealsArray.length) {
        return null;
      }

      const randomIndex = Math.floor(Math.random() * filteredMealsArray.length);
      const randomMeal = filteredMealsArray[randomIndex];

      return randomMeal;
    },
    getMeal (id) {
      if (!id) {
        return { name: 'No meal found' };
      }

      return this.$store.getters.getMeal(id) ? this.$store.getters.getMeal(id) : { name: 'No meal found' };
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
        title: 'Draw Meals',
        text: 'Let\'s take a look.',
        buttons: [
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Pick Days for Drawing',
        text: 'Select the range of dates for which you want to draw meals.',
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
        title: 'Selected Date Range',
        text: 'This is the range of dates you have selected.',
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
        title: 'Draw Meals',
        text: 'Click here to draw meals for the selected date range.',
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
        title: 'You\'re all set!',
        text: 'I hope that helped.',
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
  .draw-meals {
    text-align: center;

    .draw-meals-body {
      max-width: 600px;
      margin: 0 auto;
    }

    h1 {
      cursor: pointer;
    }
  }
</style>
