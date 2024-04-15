<template>
  <div class="header col-12">
    <h1 @click="$router.push('/')">{{headerText}}</h1>
  </div>
</template>

<script>
export default {
  props: {
    headerText: {
      type: String,
      required: true
    }
  },
};
</script>

<style lang="scss">
  .header {
    h1 {
      font-size: 2.5rem;
      font-family: 'Playfair Display', serif;
      text-align: center;
      background: #274C77;
      padding: 45px 0;
      color: white;
      cursor: pointer;
    }
  }
</style>