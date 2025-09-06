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
  async mounted () {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        console.log('App is now in the foreground');

        // Check for service worker update
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration) {
            await registration.update();
          }
        }
      }
    });
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
  font-family: "Mulish", sans-serif;

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

.start-tour-button {
  cursor: pointer;
  font-size: 1.5rem;
  height: 40px;
  position: fixed;
  right: 12px;
  width: 40px;
  bottom: 12px;
}

.shepherd-element.shepherd-has-title {
  margin-top: 15px;

  &[data-popper-placement^="top"] {
    margin-top: -15px;

    .shepherd-arrow::before {
      background-color: white !important;
    }
  }

  .shepherd-arrow::before {
    background-color: #274C77 !important;
  }

  .shepherd-content {
    .shepherd-header {
      align-items: center;
      background: #274C77;
      display: flex;
      padding: 12px;

      .shepherd-title {
        align-items: center;
        color: white;
        display: flex;
        font-size: 1.2rem;
        width: 75%;
      }

      .shepherd-cancel-icon {
        align-items: center;
        color: white;
        display: flex;
        height: 20px;
        justify-content: center;
        width: 20px;

        span {
          align-items: center;
          display: flex;
          font-size: 25px;
          height: 18px;
          justify-content: center;
          position: relative;
          top: -1px;
          width: 18px;
        }
      }
    }

    .shepherd-text {
      font-size: 0.9rem;
    }

    .shepherd-footer {
      padding: 6px;
    }
  }
}
</style>
