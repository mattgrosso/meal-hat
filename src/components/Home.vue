<template>
  <div class="home">
    <Header headerText="Meal Hat" data-step="5"/>
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
      <div class="btn-group mt-2" role="group">
        <router-link
          to="/shopping-list"
          class="btn btn-success w-100"
          data-step="4"
        >
          Shopping List
        </router-link>
      </div>
      <DrawnMealSchedule />
    </div>
    <span class="start-tour-button" @click="this.startTour()" data-step="6">
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
      if (newVal === true) {
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
        text: 'Meal Hat is a tool for helping you plan your meals and grocery shopping.<br>The main idea is that you seed the hat with meals you like to make and then, when you ask it to, the hat will randomly assign those meals to dates for you.<br>You\'ll never have to wonder what to make for dinner again!',
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
        text: 'From here you\'ll select dates you want to draw meals for and let the hat do it\'s magic.<br>I suggest you draw meals from the hat right before you go grocery shopping.<br>That way you can use the shopping list to make sure you have what you need for the meals that get drawn.',
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
        title: 'Click here to view your shopping list.',
        text: 'This is your complete grocery hub! View ingredients from drawn meals, add additional grocery items, adjust quantities if you already have some at home, and organize by aisle for efficient shopping.',
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
        title: 'The Header',
        text: 'From the header you can click your email address to log out.<br>Click the name of your hat to select a different hat.<br>And you can always click the logo to return to this Home screen.',
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
        title: 'Click here for help.',
        text: 'On each page you can click this button to get a tour of the page you\'re on.<br>It\'s a great way to learn how to use Meal Hat!',
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
        text: 'You\'ll probably want to get started by adding some meals.<br>Have fun!',
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
    align-items: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: center;

    .home-body {
      margin: 0 auto;
      max-width: 600px;

      .btn-group {
        width: 100%;

        .btn {
          font-size: 0.75rem;
        }
      }
    }
  }
</style>