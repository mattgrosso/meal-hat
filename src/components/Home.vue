<template>
  <div class="home">
    <Header headerText="Meal Hat" data-step="6"/>
    <div class="home-body p-3">
      <div class="btn-group" role="group" aria-label="Button group with nested dropdown">
        <router-link
          to="/add-meal"
          class="btn btn-tertiary"
          data-step="1"
        >
          Add Meal
        </router-link>
        <router-link
          to="/show-meals"
          class="btn btn-secondary"
          data-step="2"
        >
          Show Meals In The Hat
        </router-link>
        <router-link
          to="/draw-meals"
          class="btn btn-primary"
          data-step="3"
        >
          Draw Meals
        </router-link>
      </div>
      <div class="btn-group mt-3" role="group" aria-label="Button group with nested dropdown">
        <router-link
          to="/add-groceries"
          class="btn btn-primary"
          data-step="4"
        >
          Add Groceries
        </router-link>
        <router-link
          to="/shopping-list"
          class="btn btn-success"
          data-step="5"
        >
          Shopping List
        </router-link>
      </div>
      <DrawnMealSchedule />
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
import DrawnMealSchedule from '@/components/DrawnMealSchedule.vue';

export default {
  name: 'Home',
  components: {
    Header,
    DrawnMealSchedule
  },
  watch: {
    showTutorial (newVal) {
      console.error('1');
      if (newVal === true) {
        console.error('2');
        this.startTour();
      }
    }
  },
  computed: {
    showTutorial () {
      return this.$store.state.showTutorial;
    }
  },
  methods: {
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
        title: 'Welcome to Meal Hat!',
        text: 'Let me show you around real quick.',
        buttons: [
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Click here to add a new meal.',
        text: 'You\'ll be able to add in meals that you like to cook and also restaurants you like to order from.',
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
        title: 'Click here to view the meals in the hat.',
        text: 'From here you\'ll be able to see what meals are already in the hat and edit them.',
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
        title: 'Click here to draw meals.',
        text: 'From here you\'ll select dates you want to draw meals for and let the hat do it\'s magic.',
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
        title: 'Click here to add groceries.',
        text: 'Sometimes you need to add groceries to your shopping list that aren\'t tied to a meal. You can do that here.',
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

      tour.addStep({
        title: 'Click here to view your shopping list.',
        text: 'This will show you a checklist of the things you need to buy for the meals the hat has drawn and the groceries you\'ve added.',
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
        title: 'The Header',
        text: 'From the header you can click your email address to log out.<br>Click the name of your hat to select a different hat<br>And you can always click the logo to return to this Home screen.',
        attachTo: {
          element: '[data-step="6"]',
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
        text: 'You\'ll probably want to get started by adding some meals. Have fun!',
        buttons: [
          {
            text: 'Done',
            action: tour.complete,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.on('complete', () => {
        const dbEntry = {
          path: 'show-tutorial',
          value: false
        };

        this.$store.dispatch('updateDBValue', dbEntry);
      });

      tour.start();
    },
  },
};
</script>

<style lang="scss">
  .home {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;

    @media screen and (min-width: 768px) {
      width: 60%;
    }

    .home-body {
      .btn-group {
        .btn {
          font-size: 0.75rem;
        }
      }
    }
  }
</style>