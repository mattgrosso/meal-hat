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
        <button class="btn btn-primary my-3 col-12" @click="showNewHatPrompt">Add a hat</button>
      </div>
    </div>
  </div>
  <Modal
    :showModal="showJoinHatModal"
    title="Join a hat"
    primaryButtonText="Add Hat"
    secondaryButtonText="Cancel"
    :closeModalCallback="closeJoinHatModal"
    :primaryButtonCallback="addHatToList"
    :secondaryButtonCallback="closeJoinHatModal"
  >
    <input type="text" class="form-control" v-model="newHat" placeholder="Enter the name or email of the hat" autocomplete="new-password" name="newHat" @keyup.enter="addHatToList">
  </Modal>
  <Modal
    :showModal="showCreateHatModal"
    title="Create a hat"
    primaryButtonText="Create Hat"
    secondaryButtonText="No Thanks"
    :closeModalCallback="closeCreateHatModal"
    :primaryButtonCallback="createHatAndAddToList"
    :secondaryButtonCallback="closeCreateHatModal"
  >
    <p>That hat doesn't exist yet, do you want to create it?</p>
    <p>After you create it, other users can use it by entering the same name on their device.</p>
  </Modal>
</template>

<script>
import Header from '@/components/Header.vue';
import Modal from '@/components/Modal.vue';

export default {
  name: 'MealHats',
  components: {
    Header,
    Modal
  },
  data () {
    return {
      showJoinHatModal: false,
      showCreateHatModal: false,
      newHat: ''
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
    showNewHatPrompt () {
      this.showJoinHatModal = true;
    },
    createHatAndAddToList () {
      const createHat = true;
      this.addHatToList("event", createHat);
    },
    addHatToList (event, createHat) {
      if (!this.newHat) {
        this.closeAllModals();
        return;
      }

      const newHat = this.newHat.replaceAll(/[-!$%@^&*()_+|~=`{}[\]:";'<>?,./]/g, "-");

      if (!createHat && !this.$store.state.allHatsList.includes(newHat)) {
        this.closeJoinHatModal();
        this.showCreateHatModal = true;
        return;
      }

      if (createHat) {
        this.$store.dispatch('createNewHat', newHat);
        this.closeCreateHatModal();
      }

      const newHatList = [...this.mealHatsList, newHat];
      const dbEntry = {
        path: `meal-hats-list`,
        value: newHatList
      }

      this.$store.commit('setMealHatsList', newHatList);
      this.$store.dispatch('updateUserDBValue', dbEntry);

      this.closeJoinHatModal();
      this.newHat = '';
    },
    showDeleteButton (mealHatName) {
      return mealHatName !== this.$store.getters.primaryDatabaseTopKey;
    },
    closeAllModals () {
      this.closeJoinHatModal();
      this.closeCreateHatModal();
    },
    closeJoinHatModal () {
      this.showJoinHatModal = false;
    },
    closeCreateHatModal () {
      this.showCreateHatModal = false;
      this.newHat = '';
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