<template>
  <div class="login">
    <Header headerText="Meal Hat Login"/>
    <div class="login-prompt d-flex justify-content-center py-5">
      <button @click="login" class="btn btn-primary google-signin-button">
        <i class="bi bi-google me-2"></i>
        Sign in with Google
      </button>
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
    async login () {
      await this.$store.dispatch('login');
    }
  }
}
</script>

<style lang="scss" scoped>
.google-signin-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  font-size: 16px;
  font-weight: bold;
  transition: background-color 0.3s, color 0.3s;
}

</style>