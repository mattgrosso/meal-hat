<template>
  <div class="draw-meals">
    <h1 class="my-3">Draw Meals</h1>
    <h3 class="my-3">Pick Days for drawing</h3>
    <VDatePicker v-model.range="dateRange" :attributes='attributes' :disabled-dates="datesWithMeals" expanded/>
    <div v-if="hasDateRange" class="date-range my-3">
      <div class="range">
        <span class="mx-2 fw-bold">{{ formattedStartDate }}</span>
        <span>to</span>
        <span class="mx-2 fw-bold">{{ formattedEndDate }}</span>
      </div>
      <button class="btn btn-primary my-3" @click="drawMeals">Draw Meals</button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'DrawMeals',
  data () {
    return {
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
      if (!this.$store.state.drawnMeals) {
        return [];
      } else {
        return this.$store.state.drawnMeals.map((drawnMeal) => {
          return new Date(drawnMeal.assignedDate);
        });
      }
    },
    attributes () {
      if (!this.$store.state.drawnMeals || !this.$store.state.drawnMeals.length) {
        return [];
      }

      const assignedMeals = this.$store.state.drawnMeals.map((meal) => {
        return {
          highlight: {
            color: 'green',
            fillMode: 'outline',
          },
          popover: {
            label: meal.meal.name,
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
            fillMode: 'solid',
          },
          dates: [new Date()]
        }
      ]
    }
  },
  methods: {
    drawMeals () {
      this.allDatesInRange.forEach(async (date) => {
        const randomMeal = await this.$store.dispatch('getRandomMeal');

        const dbEntry = {
          path: "drawnMeals",
          value: {
            meal: randomMeal,
            assignedDate: date.toDateString()
          }
        }

        const drawnMealForUpdate = {
          path: `meals/${randomMeal.id}`,
          value: {
            ...randomMeal,
            lastDrawn: date
          }
        }

        this.$store.dispatch('updateDBValue', drawnMealForUpdate);
        this.$store.dispatch('setDBValue', dbEntry);
        // this.$router.push('/');
      });
    }
  },
}
</script>

<style lang="scss">
  .draw-meals {
    max-width: 600px;
    margin: 0 auto;
  }
</style>
