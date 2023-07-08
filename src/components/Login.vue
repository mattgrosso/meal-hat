<template>
  <div class="login">
    <h1 class="col-12 text-center">Welcome to Meal Hat</h1>
    <h2 class="col-12 text-center fs-6 mb-5">Please sign in with Google</h2>
    <div class="login-prompt d-flex justify-content-center">
      <GoogleLogin :callback="login" prompt auto-login/>
    </div>
  </div>
</template>

<script>
export default {
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