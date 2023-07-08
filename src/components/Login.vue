<template>
  <div class="login">
    <h1 class="col-12 text-center">Welcome to Movie Log</h1>
    <h2 class="col-12 text-center fs-6 mb-5">Please sign in with Google</h2>
    <GoogleLogin :callback="login" prompt auto-login/>
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
  .login {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    margin: 30vh 24px;
  }
</style>