<template>
  <div class="meal-hat">
    <router-view></router-view>
  </div>
</template>

<script>
export default {
  name: 'meal-hat',
  mounted () {
    this.$store.dispatch('initializeDB');
  },
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>
