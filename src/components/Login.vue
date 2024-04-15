<template>
  <div class="login">
    <Header headerText="Welcome to Meal Hat"/>
    <h2 class="col-12 text-center fs-6 mb-5">Please sign in with Google</h2>
    <div class="login-prompt d-flex justify-content-center">
      <GoogleLogin :callback="login" prompt auto-login/>
    </div>
  </div>
</template>

<script>
import Header from '@/components/Header.vue';

export default {
  components: {
    Header
  },
  methods: {
    async login (resp) {
      await this.$store.dispatch('login', resp);
      this.$router.push('/');
    }
  }
}
</script>

<style lang="scss">
</style>