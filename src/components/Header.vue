<template>
  <div @click="$router.push('/')" class="header col-12">
    <h1>{{headerText}}</h1>
    <div class="user-and-hat col-12">
      <p class="col-6">{{$store.state.userEmail}}</p>
      <p class="col-6" @click.stop="$router.push('/meal-hats')">{{hatTitle}}</p>
    </div>
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
  computed: {
    hatTitle () {
      if (this.$store.getters.primaryDatabaseTopKey === this.$store.state.databaseTopKey) {
        return "your default hat";
      } else {
        return this.$store.state.databaseTopKey;
      }
    }
  },
};
</script>

<style lang="scss">
  .header {
    background: #274C77;
    color: white;
    cursor: pointer;
    padding: 45px 1rem;
    position: relative;

    h1 {
      font-size: 2.5rem;
      font-family: 'Playfair Display', serif;
      margin: 0;
      text-align: center;
    }

    .user-and-hat {
      display: flex;
      justify-content: space-between;
      position: absolute;
      bottom: 0;
      left: 0;

      p {
        font-size: 0.75rem;
        margin: 0;
        padding: 0.25rem;

        &:first-child {
          padding-left: 1rem;
          text-align: left;
        }

        &:last-child {
          padding-right: 1rem;
          text-align: right;
          text-decoration: underline;
        }
      }
    }
  }
</style>