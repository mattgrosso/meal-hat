<template>
  <div class="draw-meals">
    <h1>Draw Meals</h1>
    <div class="draw-meals-body p-3">
      <h3 class="my-2">Pick Days for drawing</h3>
      <VDatePicker v-model.range="dateRange" :attributes='attributes' :disabled-dates="datesWithMeals" expanded/>
      <div v-if="hasDateRange" class="date-range my-3">
        <div class="range">
          <span class="mx-2 fw-bold">{{ formattedStartDate }}</span>
          <span>to</span>
          <span class="mx-2 fw-bold">{{ formattedEndDate }}</span>
        </div>
        <button class="btn btn-primary my-3" @click="drawMeals">Draw Meals</button>
      </div>
      <div v-if="message" class="messages">{{ message }}</div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'DrawMeals',
  data () {
    return {
      message: null,
      dateRange: {
        start: null,
        end: null
      }
    }
  },
  computed: {
    hasDateRange () {
      return this.dateRange.start && this.dateRange.end;
    },
    formattedStartDate () {
      return this.dateRange.start ? this.dateRange.start.toDateString() : null;
    },
    formattedEndDate () {
      return this.dateRange.end ? this.dateRange.end.toDateString() : null;
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
    }
  },
}
</script>

<style lang="scss">
  .draw-meals {
    max-width: 600px;
    margin: 0 auto;
    text-align: center;
  }
</style>
