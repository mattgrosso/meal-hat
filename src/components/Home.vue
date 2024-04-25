<template>
  <div class="home">
    <Header headerText="Meal Hat"/>
    <div class="home-body p-3">
      <div class="btn-group" role="group" aria-label="Button group with nested dropdown">
        <router-link
          to="/add-meal"
          class="btn btn-tertiary"
        >
          Add Meal
        </router-link>
        <router-link
          to="/show-meals"
          class="btn btn-secondary"
        >
          Show Meals In The Hat
        </router-link>
        <router-link
          to="/draw-meals"
          class="btn btn-primary"
        >
          Draw Meals
        </router-link>
      </div>
      <div class="btn-group mt-3" role="group" aria-label="Button group with nested dropdown">
        <router-link
          to="/add-groceries"
          class="btn btn-primary"
        >
          Add Groceries
        </router-link>
        <router-link
          to="/shopping-list"
          class="btn btn-success"
        >
          Shopping List
        </router-link>
      </div>
      <DrawnMealSchedule />
    </div>
  </div>
</template>

<script>
import Header from '@/components/Header.vue';
import DrawnMealSchedule from '@/components/DrawnMealSchedule.vue';

export default {
  name: 'Home',
  components: {
    Header,
    DrawnMealSchedule
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