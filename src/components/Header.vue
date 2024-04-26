<template>
  <div class="header col-12">
    <h1>{{headerText}}</h1>
    <img @click="$router.push('/')" :src="require('@/assets/icon.png')" alt="Icon">
    <div class="user-and-hat col-12">
      <p class="col-6" @click.stop="logout">{{$store.state.userEmail}}</p>
      <p class="col-6" @click.stop="$router.push('/meal-hats')">{{hatTitle}}</p>
    </div>
    <span class="version">{{version}}</span>
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
    version () {
      return process.env.VUE_APP_VERSION;
    },
    hatTitle () {
      if (this.$store.getters.primaryDatabaseTopKey === this.$store.state.databaseTopKey) {
        return "your default hat";
      } else {
        return this.$store.state.databaseTopKey;
      }
    }
  },
  methods: {
    logout () {
      this.$store.dispatch('logout');
      this.$router.push('/login');
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
      font-family: "Playfair Display", serif;
      margin: 0;
      text-align: center;
      position: absolute;
      top: 8px;
      left: 16px;
    }

    img {
      position: absolute;
      top: 9px;
      right: 16px;
      height: 48px;
    }

    .user-and-hat {
      display: flex;
      justify-content: space-between;
      position: absolute;
      bottom: 6px;
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

    .version {
      font-family: "Roboto Condensed", sans-serif;
      font-size: 0.5rem;
      position: absolute;
      right: 3px;
      top: 2px;
    }
  }
</style>