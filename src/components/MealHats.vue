<template>
  <div class="meal-hats-list">
    <Header headerText="Meal Hats"/>
    <div class="meal-hats-list-body">
      <ul data-step="1">
        <li v-for="(mealHat, index) in mealHatsList" :key="index" class="col-12 my-2">
          <div class="btn-group w-100" role="group">
            <button type="button" class="btn btn-secondary flex-grow-1" style="width: 70%;" @click="switchToMealHat(mealHat)" :data-step="index === 0 ? '2' : undefined">{{mealHat}}</button>
            <button type="button" class="btn btn-primary" @click="shareMealHat(mealHat)" :style="{ width: showDeleteButton(mealHat) ? '15%' : '30%' }" :data-step="index === 0 ? '3' : undefined">
              <i class="bi bi-share-fill"></i>
            </button>
            <button v-if="showDeleteButton(mealHat)" type="button" class="btn btn-danger" style="width: 15%;" @click="removeMealhat(mealHat)" :data-step="index === 1 ? '4' : undefined">
              <i class="bi bi-trash-fill"></i>
            </button>
          </div>
        </li>
      </ul>
      <div class="add-more-hats" data-step="5">
        <button class="btn btn-primary my-3 col-12" @click="showNewHatPrompt">Add a hat</button>
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
  mounted () {
    if (this.$route.params.sharedMealHatName) {
      this.newHat = this.$route.params.sharedMealHatName;
      this.addHatToList();
      this.switchToMealHat(this.$route.params.sharedMealHatName);
    }
  },
  computed: {
    mealHatsList () {
      return this.$store.state.mealHatsList || [];
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
    shareMealHat (mealHatName) {
      const shareUrl = `${window.location.href}/${mealHatName}`;

      if (navigator.share) {
        navigator.share({
          title: 'Meal Hat',
          text: `Join my meal hat: ${mealHatName}`,
          url: shareUrl
        });
      } else {
        navigator.clipboard.writeText(shareUrl);
        this.$emit('showToast', {
          delay: 3000,
          message: 'Shareable URL copied to clipboard.'
        });
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

      const newHatList = [...new Set([...this.mealHatsList, newHat])];
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
        title: 'Meal Hats',
        text: 'You can have more than one meal hat and you can share them with others. Let me show you around.',
        buttons: [
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'List of Hats',
        text: 'This is a list of all the hats you are a part of.',
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
        title: 'Hat Title',
        text: 'Click on the name of a hat to switch to it.',
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
        title: 'Share a Hat',
        text: 'Click this button to share the hat with someone else. They can also add it to their list of hats just by entering the hat\'s name.',
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

      if (document.querySelector('[data-step="4"]')) {
        tour.addStep({
          title: 'Delete Hat',
          text: 'Click this button to remove the hat from your list. You can\'t ever delete your default hat.',
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
      }

      tour.addStep({
        title: 'Add a Hat',
        text: 'Click this button to add a new hat to your list. You can also join someone else\'s hat by entering its name here.',
        attachTo: {
          element: '[data-step="5"]',
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
        title: 'That\'s all',
        text: 'Enjoy your meal hats!',
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

    .btn-secondary {
      font-size: 0.8rem;
    }
  }
</style>