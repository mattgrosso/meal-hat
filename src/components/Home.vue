<template>
  <div class="home">
    <h1 class="col-12">Meal Hat</h1>
    <div class="home-body p-3">
      <router-link
        to="/add-meal"
        class="btn btn-primary col-12 md-col-4 my-3"
      >
        Add Meal
      </router-link>
      <router-link
        to="/show-meals"
        class="btn btn-primary col-12 md-col-4 my-3"
      >
        Show Meals In The Hat
      </router-link>
      <router-link
        to="/draw-meals"
        class="btn btn-primary col-12 md-col-4 my-3"
      >
        Draw Meals
      </router-link>
      <router-link
        to="/shopping-list"
        class="btn btn-primary col-12 md-col-4 my-3"
      >
        Shopping List
      </router-link>
      <DrawnMealSchedule />
    </div>
  </div>
</template>

<script>
import DrawnMealSchedule from '@/components/DrawnMealSchedule.vue';

export default {
  name: 'Home',
  components: {
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
  }
</style>