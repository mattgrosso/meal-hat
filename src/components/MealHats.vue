<template>
  <div class="meal-hats-list">
    <Header headerText="Meal Hats"/>
    <div class="meal-hats-list-body">
      <ul>
        <li v-for="(mealHat, index) in mealHatsList" :key="index" class="col-12 my-2">
          <div class="d-flex justify-content-between align-items-center">
            <button type="button" class="btn btn-secondary flex-grow-1" @click="switchToMealHat(mealHat)">{{mealHat}}</button>
            <button v-if="showDeleteButton(mealHat)" type="button" class="btn btn-danger ms-2" @click="removeMealhat(mealHat)">Delete</button>
          </div>
        </li>
      </ul>
      <div class="add-more-hats">
        <button class="btn btn-primary my-3 col-12" @click="addHatToList">Add Someone Else's Hat</button>
      </div>
    </div>
  </div>
</template>

<script>
import Header from '@/components/Header.vue';

export default {
  name: 'MealHats',
  components: {
    Header
  },
  mounted () {
    if (!this.$store.state.mealHatsList || !this.$store.state.mealHatsList.length) {
      const primaryDatabaseTopKey = this.$store.getters.primaryDatabaseTopKey;

      const dbEntry = {
        path: `meal-hats-list`,
        value: [primaryDatabaseTopKey]
      }

      this.$store.commit('setMealHatsList', [primaryDatabaseTopKey]);
      this.$store.dispatch('updateUserDBValue', dbEntry);
    }
  },
  computed: {
    mealHatsList () {
      return this.$store.state.mealHatsList;
    }
  },
  methods: {
    switchToMealHat (mealHatName) {
      this.$store.dispatch('switchDatabase', mealHatName);
      this.$router.push('/');
    },
    removeMealhat (mealHatName) {
      const newHatList = this.mealHatsList.filter((hat) => hat !== mealHatName);
      
      const dbEntry = {
        path: `meal-hats-list`,
        value: newHatList
      }
      
      this.$store.commit('setMealHatsList', newHatList);
      this.$store.dispatch('updateUserDBValue', dbEntry);

      if (mealHatName === this.$store.getters.databaseTopKey) {
        this.$store.dispatch('switchDatabase', this.$store.getters.primaryDatabaseTopKey);
        this.$router.push('/');
      }
    },
    addHatToList () {
      const newHat = prompt('Enter the email of the hat you want to add to the list').replaceAll(/[-!$%@^&*()_+|~=`{}[\]:";'<>?,./]/g, "-");

      if (!newHat) {
        return;
      }

      const newHatList = [...this.mealHatsList, newHat];
      const dbEntry = {
        path: `meal-hats-list`,
        value: newHatList
      }

      this.$store.commit('setMealHatsList', newHatList);
      this.$store.dispatch('updateUserDBValue', dbEntry);
    },
    showDeleteButton (mealHatName) {
      return mealHatName !== this.$store.getters.primaryDatabaseTopKey;
    }
  },
};
</script>

<style lang="scss">
  .meal-hats-list {
    ul {
      list-style: none;
      padding: 0 32px;
      margin: 0;
    }

    .add-more-hats {
      border-top: 1px solid black;
      padding: 0 32px;
    }
  }
</style>