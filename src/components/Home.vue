<template>
  <div class="home mx-auto">
    <router-link
      to="/add-meal"
      class="btn btn-primary col-4 my-2"
    >
      Add Meal
    </router-link>
    <router-link
      to="/show-meals"
      class="btn btn-primary col-4 my-2"
    >
      Show Meals In The Hat
    </router-link>
    <router-link
      to="/draw-meals"
      class="btn btn-success col-4 my-2"
    >
      Draw Meals
    </router-link>
    <DrawnMealSchedule />
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
    width: 60%;
  }
</style>