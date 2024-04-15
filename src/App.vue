<template>
  <div class="meal-hat">
    <router-view></router-view>
  </div>
</template>

<script>
export default {
  name: 'MealHat'
}
</script>

<style lang="scss">
body {
  touch-action: manipulation;
}

#app {
  font-family: 'Mulish', sans-serif;

  .btn-primary {
    background: #408558;
    border-color: #408558;
  }

  .btn-secondary {
    background: #274C77;
    border-color: #274C77;
  }

  .btn-tertiary {
    background: #91C4F2;
    border-color: #91C4F2;
  }

  .btn-success {
    background: #FE7F2D;
    border-color: #FE7F2D;
    color: white;
  }

  .btn-warning {
    background: #F8333C;
    border-color: #F8333C;
    color: white;
  }
}
</style>
