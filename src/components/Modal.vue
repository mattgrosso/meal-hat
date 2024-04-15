<template>
  <div class="modal fade" id="meal-hat-modal" tabindex="-1" aria-labelledby="mealHatModalLabel" aria-hidden="true" v-bind:class="{ 'show d-block': showModal }">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="mealHatModalLabel">{{title}}</h5>
          <button type="button" class="btn-close" @click="closeModalCallback" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <slot></slot>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="secondaryButtonCallback">{{secondaryButtonText}}</button>
          <button type="button" class="btn btn-primary" @click="primaryButtonCallback">{{primaryButtonText}}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    showModal: {
      type: Boolean,
      required: true
    },
    title: {
      type: String,
      required: true
    },
    primaryButtonText: {
      type: String,
      required: true
    },
    secondaryButtonText: {
      type: String,
      required: true
    },
    closeModalCallback: {
      type: Function,
      required: true
    },
    primaryButtonCallback: {
      type: Function,
      required: true
    },
    secondaryButtonCallback: {
      type: Function,
      required: true
    }
  },
};
</script>

<style lang="scss">

</style>