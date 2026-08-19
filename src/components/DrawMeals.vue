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
import { todayISO, fromISODate, datesInRange, drawnTooRecently } from '@/store/schedule';

export default {
  name: 'DrawMeals',
  components: {
    Header
  },
  data () {
    return {
      message: null,
      dateRange: {
        // todayISO, not toISOString().slice(0, 10) — the latter is UTC, so from
        // late afternoon onwards in US timezones it preselected TOMORROW.
        start: todayISO(),
        end: todayISO()
      }
    }
  },
  computed: {
    hasDateRange () {
      return this.dateRange.start && this.dateRange.end;
    },
    formattedStartDate () {
      // fromISODate, not new Date(iso) — the latter parses as UTC midnight and
      // rendered the day BEFORE the one that was picked.
      return this.formatLong(this.dateRange.start);
    },
    formattedEndDate () {
      return this.formatLong(this.dateRange.end ?? this.dateRange.start);
    },
    allDatesInRange () {
      // Was a hand-rolled cursor comparing a Date against a string, which only
      // worked because the string coerced. datesInRange also holds its footing
      // across a DST change, where adding 24h at a time can repeat a day.
      return datesInRange(this.dateRange.start, this.dateRange.end);
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
            popover: {
              label: this.getMeal(meal.mealId).name,
              visibility: 'click'
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
    async drawMeals () {
      const assignments = [];
      const unfilled = [];

      this.allDatesInRange.forEach((isoDate) => {
        const meal = this.getRandomMealForDate(isoDate, assignments);

        if (!meal) {
          unfilled.push(isoDate);
          return;
        }

        assignments.push({ meal, isoDate });
      });

      // Say which days came up empty, and how many — the old message named only
      // whichever day failed last, so a range that mostly failed looked like a
      // single bad day.
      this.message = unfilled.length
        ? `No meal available for ${unfilled.length} of ${this.allDatesInRange.length} days (${unfilled.map(this.formatShort).join(', ')}). Add more meals, or shorten how long they wait between repeats.`
        : null;

      if (!assignments.length) return;

      // One atomic write for the whole draw, then regenerate the shopping list
      // from it. The regeneration re-reads drawn meals from the database, so the
      // draw has to have landed first.
      await this.$store.dispatch('applyDraw', { assignments });
      await this.$store.dispatch('generateShoppingListFromMeals');

      this.$router.push('/');
    },
    formatShort (isoDate) {
      const date = fromISODate(isoDate);
      return date ? date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : isoDate;
    },
    formatLong (value) {
      const date = fromISODate(value);
      return date ? date.toDateString() : null;
    },
    getRandomMealForDate (isoDate, alreadyAssigned) {
      const takenIds = new Set(alreadyAssigned.map(({ meal }) => meal.id));

      const allMeals = this.$store.state.meals;
      if (typeof allMeals !== 'object' || allMeals === null) {
        return null;
      }

      const eligible = Object.values(allMeals).filter((meal) => {
        return !drawnTooRecently(meal, isoDate) && !takenIds.has(meal.id);
      });

      if (!eligible.length) {
        return null;
      }

      return eligible[Math.floor(Math.random() * eligible.length)];
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
