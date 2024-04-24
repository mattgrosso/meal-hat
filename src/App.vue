<template>
  <div class="meal-hat">
    <router-view @showToast="showToast"></router-view>
    <div class="toast" role="alert" aria-live="assertive" aria-atomic="true" id="myToast">
      <div class="toast-body">
        {{toastMessage}}
      </div>
    </div>
  </div>
</template>

<script>
import { Toast } from 'bootstrap';

export default {
  name: 'MealHat',
  data () {
    return {
      toastMessage: ""
    }
  },
  methods: {
    showToast (config) {
      this.toastMessage = config.message;
      const toastEl = document.getElementById('myToast');
      const toast = new Toast(toastEl, {
        autohide: true,
        delay: config.delay || 5000
      });
      toast.show();

      setTimeout(() => {
        this.toastMessage = "";
      }, config.delay + 100 || 5100);
    },
  },
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

  .toast.show {
    position: absolute;
    top: 16px;
    width: 80%;
    left: 50%;
    transform: translateX(-50%);
  }
}
</style>
