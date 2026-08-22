<template>
  <div class="header col-12">
    <h1>{{headerText}}</h1>
    <img @click="$router.push('/')" :src="require('@/assets/icon.png')" alt="Icon">
    <div class="user-and-hat col-12">
      <p class="col-6 col-md-2" @click.stop="logout">{{$store.state.userEmail}}</p>
      <p class="col-6 col-md-2" @click.stop="$router.push('/meal-hats')">{{hatTitle}}</p>
    </div>
    <span class="build-stamp">{{buildStamp}}</span>
  </div>
</template>

<script>
import { buildStamp } from '../utils/buildStamp.js';

export default {
  props: {
    headerText: {
      type: String,
      required: true
    }
  },
  computed: {
    // The house build stamp — "v1.14.0 · built Aug 22, 8:15 AM". Was the bare
    // version number; the version alone can't tell you whether the app in
    // front of you picked up the deploy you just did.
    buildStamp () {
      return buildStamp();
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

    // The house build stamp: present, readable, never competing for
    // attention. Same corner the bare version number used to sit in, but it
    // is a longer string now — line-height 1 and top 1px keep its 8px box
    // clear of the icon below it (top: 9px), and nowrap keeps it on one line
    // at phone width rather than wrapping under the icon.
    .build-stamp {
      font-family: "Roboto Condensed", sans-serif;
      font-size: 0.5rem;
      font-variant-numeric: tabular-nums;
      line-height: 1;
      opacity: 0.85;
      position: absolute;
      right: 3px;
      top: 1px;
      white-space: nowrap;
    }
  }
</style>