<template>
  <div class="meal-hats-list">
    <Header headerText="Meal Hats"/>
    <div class="meal-hats-list-body">
      <ul data-step="1">
        <li v-for="(mealHat, index) in mealHatsList" :key="index" class="col-12 my-2">
          <div class="btn-group w-100" role="group">
            <button type="button" class="btn btn-secondary flex-grow-1" @click="switchToMealHat(mealHat)" :data-step="index === 0 ? '2' : undefined">{{mealHat}}</button>
            <button type="button" class="btn btn-tertiary" title="Who's in this hat" aria-label="Who's in this hat" @click="toggleMembers(mealHat)" :data-step="index === 0 ? '6' : undefined">
              <i class="bi bi-people-fill"></i>
            </button>
            <button type="button" class="btn btn-primary" @click="shareMealHat(mealHat)" :data-step="index === 0 ? '3' : undefined">
              <i class="bi bi-share-fill"></i>
            </button>
            <button v-if="showDeleteButton(mealHat)" type="button" class="btn btn-danger" @click="removeMealhat(mealHat)" :data-step="index === 1 ? '4' : undefined">
              <i class="bi bi-trash-fill"></i>
            </button>
          </div>

          <!-- Roster. Only readable at all if you are in the hat, which the
               rules enforce — so this can never show someone else's household. -->
          <div v-if="openMembersFor === mealHat" class="hat-members">
            <p v-if="membersLoading" class="hat-members__status">Loading&hellip;</p>
            <template v-else>
              <ul class="hat-members__list">
                <li v-for="member in members" :key="member.uid">
                  <span class="hat-members__who">
                    {{ member.email || member.uid }}
                    <span v-if="member.isSelf" class="hat-members__you">you</span>
                  </span>
                  <button
                    v-if="!member.isSelf"
                    type="button"
                    class="btn btn-sm btn-danger"
                    :disabled="removingUid === member.uid"
                    @click="removeMember(mealHat, member)"
                  >
                    {{ removingUid === member.uid ? 'Removing…' : 'Remove' }}
                  </button>
                  <!-- No control to remove yourself: a hat with no members is
                       readable by nobody, so self-removal from a hat you are
                       alone in would destroy access permanently. -->
                  <span v-else class="hat-members__self-note">can't remove yourself</span>
                </li>
              </ul>
              <p v-if="!members.length" class="hat-members__status">Nobody listed.</p>
              <p v-if="memberError" class="join-error">{{ memberError }}</p>
              <p class="hat-members__hint">Anyone with the share link can join. Send a fresh link only to people you want in.</p>
            </template>
          </div>
        </li>
      </ul>
      <p v-if="joinError" class="join-error">{{ joinError }}</p>
      <div class="add-more-hats" data-step="5">
        <button class="btn btn-primary my-3 col-12" @click="showNewHatPrompt">Add a hat</button>
      </div>
    </div>
    <Modal
      :showModal="showJoinHatModal"
      title="Join a hat"
      primaryButtonText="Add Hat"
      secondaryButtonText="Cancel"
      :closeModalCallback="closeJoinHatModal"
      :primaryButtonCallback="addHatToList"
      :secondaryButtonCallback="closeJoinHatModal"
    >
      <input type="text" class="form-control" v-model="newHat" placeholder="Enter the name or email of the hat" autocomplete="new-password" name="newHat" @keyup.enter="addHatToList">
    </Modal>
    <Modal
      :showModal="showCreateHatModal"
      title="Create a hat"
      primaryButtonText="Create Hat"
      secondaryButtonText="No Thanks"
      :closeModalCallback="closeCreateHatModal"
      :primaryButtonCallback="createHatAndAddToList"
      :secondaryButtonCallback="closeCreateHatModal"
    >
      <p>That hat doesn't exist yet, do you want to create it?</p>
      <p>After you create it, other users can use it by entering the same name on their device.</p>
    </Modal>
    <span class="start-tour-button" @click="this.startTour()">
      <i class="bi bi-question-circle"/>
    </span>
  </div>
</template>

<script>
// Shepherd is loaded ON DEMAND, inside startTour().
//
// It was a static import here and in five other components, so the tour library
// and its stylesheet were downloaded by every visit — to power a "?" button most
// visits never press.
import Header from '@/components/Header.vue';
import Modal from '@/components/Modal.vue';

export default {
  name: 'MealHats',
  components: {
    Header,
    Modal
  },
  data () {
    return {
      showJoinHatModal: false,
      showCreateHatModal: false,
      newHat: '',
      joinError: null,
      openMembersFor: null,
      members: [],
      membersLoading: false,
      memberError: null,
      removingUid: null
    }
  },
  async mounted () {
    const shared = this.$route.params.sharedMealHatName;
    if (!shared) return;

    this.newHat = shared;

    // A share link carries the hat's code; joining is a single write that the
    // rules validate against the hat's own joinCode server-side.
    const code = this.$route.query.code;
    if (code) {
      try {
        await this.$store.dispatch('joinHatWithCode', { hatName: shared, code });
      } catch {
        this.joinError = 'That invite link is not valid any more. Ask for a fresh one.';
        return;
      }
    }

    await this.addHatToList();
    this.switchToMealHat(shared);
  },
  computed: {
    mealHatsList () {
      return this.$store.state.mealHatsList || [];
    }
  },
  methods: {
    // Fetched on open rather than for every hat up front: each roster is its
    // own read, and most of the time you are not looking at any of them.
    async toggleMembers (mealHatName) {
      if (this.openMembersFor === mealHatName) {
        this.openMembersFor = null;
        return;
      }

      this.openMembersFor = mealHatName;
      this.members = [];
      this.memberError = null;
      this.membersLoading = true;
      this.members = await this.$store.dispatch('getHatMembers', mealHatName);
      this.membersLoading = false;
    },
    async removeMember (mealHatName, member) {
      this.memberError = null;
      this.removingUid = member.uid;

      try {
        await this.$store.dispatch('removeHatMember', { hatName: mealHatName, uid: member.uid });
        this.members = this.members.filter((m) => m.uid !== member.uid);
        this.$emit('showToast', {
          delay: 3000,
          message: `Removed ${member.email || 'that person'} from ${mealHatName}.`
        });
      } catch (error) {
        this.memberError = error.message || 'Could not remove them.';
      } finally {
        this.removingUid = null;
      }
    },
    switchToMealHat (mealHatName) {
      this.$store.dispatch('switchDatabase', mealHatName);
      this.$router.push('/');
    },
    removeMealhat (mealHatName) {
      const newHatList = this.mealHatsList.filter((hat) => hat !== mealHatName);

      const dbEntry = {
        path: `meal-hats-list`,
        value: newHatList
      }

      this.$store.commit('setMealHatsList', newHatList);
      this.$store.dispatch('updateUserDBValue', dbEntry);

      if (mealHatName === this.$store.getters.databaseTopKey) {
        this.$store.dispatch('switchDatabase', this.$store.getters.primaryDatabaseTopKey);
        this.$router.push('/');
      }
    },
    async shareMealHat (mealHatName) {
      // The code rides in the link. Sharing is unchanged from the user's side —
      // send the link, they tap it — but the name alone is no longer enough to
      // get in, which is the whole point.
      const code = await this.$store.dispatch('getHatJoinCode', mealHatName);
      const base = `${window.location.href}/${mealHatName}`;
      const shareUrl = code ? `${base}?code=${encodeURIComponent(code)}` : base;

      if (navigator.share) {
        navigator.share({
          title: 'Meal Hat',
          text: `Join my meal hat: ${mealHatName}`,
          url: shareUrl
        });
      } else {
        navigator.clipboard.writeText(shareUrl);
        this.$emit('showToast', {
          delay: 3000,
          message: 'Shareable URL copied to clipboard.'
        });
      }
    },
    showNewHatPrompt () {
      this.joinError = null;
      this.showJoinHatModal = true;
    },
    createHatAndAddToList () {
      const createHat = true;
      this.addHatToList("event", createHat);
    },
    async addHatToList (event, createHat) {
      if (!this.newHat) {
        this.closeAllModals();
        return;
      }

      const newHat = this.newHat.replaceAll(/[-!$%@^&*()_+|~=`{}[\]:";'<>?,./]/g, "-");

      // One targeted lookup, rather than testing against a client-side copy of
      // every hat in the database.
      if (!createHat && !await this.$store.dispatch('hatExists', newHat)) {
        this.closeJoinHatModal();
        this.showCreateHatModal = true;
        return;
      }

      if (createHat) {
        try {
          await this.$store.dispatch('createNewHat', newHat);
        } catch {
          // Refused means the name is taken by a hat this user cannot see. The
          // rules allow writing a hat you are not a member of only when it does
          // not exist, so this is the one honest signal available — and it is
          // the moment to say "you need the link" rather than pretend the hat
          // is missing.
          this.closeCreateHatModal();
          this.joinError = `"${newHat}" already exists and is private. Ask whoever owns it for the share link.`;
          return;
        }
        this.closeCreateHatModal();
      }

      const newHatList = [...new Set([...this.mealHatsList, newHat])];
      const dbEntry = {
        path: `meal-hats-list`,
        value: newHatList
      }

      this.$store.commit('setMealHatsList', newHatList);
      this.$store.dispatch('updateUserDBValue', dbEntry);

      this.closeJoinHatModal();
      this.newHat = '';
    },
    showDeleteButton (mealHatName) {
      return mealHatName !== this.$store.getters.primaryDatabaseTopKey;
    },
    closeAllModals () {
      this.closeJoinHatModal();
      this.closeCreateHatModal();
    },
    closeJoinHatModal () {
      this.showJoinHatModal = false;
    },
    closeCreateHatModal () {
      this.showCreateHatModal = false;
      this.newHat = '';
    },
    async startTour () {
      const [{ default: Shepherd }] = await Promise.all([
        import(/* webpackChunkName: "tour" */ 'shepherd.js'),
        import(/* webpackChunkName: "tour" */ 'shepherd.js/dist/css/shepherd.css')
      ]);

      const tour = new Shepherd.Tour({
        defaultStepOptions: {
          classes: 'mx-auto col-9',
          cancelIcon: {
            enabled: true
          }
        },
        useModalOverlay: true
      });

      tour.addStep({
        title: 'Meal Hats',
        text: 'You can have more than one meal hat and you can share them with others. Let me show you around.',
        buttons: [
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'List of Hats',
        text: 'This is a list of all the hats you are a part of.',
        attachTo: {
          element: '[data-step="1"]',
          on: 'bottom'
        },
        buttons: [
          {
            text: 'Back',
            action: tour.back,
            classes: 'btn-secondary btn btn-sm'
          },
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Hat Title',
        text: 'Click on the name of a hat to switch to it.',
        attachTo: {
          element: '[data-step="2"]',
          on: 'bottom'
        },
        buttons: [
          {
            text: 'Back',
            action: tour.back,
            classes: 'btn-secondary btn btn-sm'
          },
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Who\'s in this hat',
        text: 'Everyone sharing this hat, and a way to remove somebody. You will not find yourself in that list with a Remove button — a hat with nobody in it could never be opened again.',
        attachTo: {
          element: '[data-step="6"]',
          on: 'bottom'
        },
        buttons: [
          {
            text: 'Back',
            action: tour.back,
            classes: 'btn-secondary btn btn-sm'
          },
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Share a Hat',
        text: 'Send someone this hat\'s link and they can join it. The link carries an invite code — typing the hat\'s name on its own will not get anybody in, so share the link rather than the name.',
        attachTo: {
          element: '[data-step="3"]',
          on: 'bottom'
        },
        buttons: [
          {
            text: 'Back',
            action: tour.back,
            classes: 'btn-secondary btn btn-sm'
          },
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      if (document.querySelector('[data-step="4"]')) {
        tour.addStep({
          title: 'Delete Hat',
          text: 'Click this button to remove the hat from your list. You can\'t ever delete your default hat.',
          attachTo: {
            element: '[data-step="4"]',
            on: 'bottom'
          },
          buttons: [
            {
              text: 'Back',
              action: tour.back,
              classes: 'btn-secondary btn btn-sm'
            },
            {
              text: 'Next',
              action: tour.next,
              classes: 'btn-success btn btn-sm'
            }
          ]
        });
      }

      tour.addStep({
        title: 'Add a Hat',
        text: 'Click this button to add a new hat to your list. You can also join someone else\'s hat by entering its name here.',
        attachTo: {
          element: '[data-step="5"]',
          on: 'bottom'
        },
        buttons: [
          {
            text: 'Back',
            action: tour.back,
            classes: 'btn-secondary btn btn-sm'
          },
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'That\'s all',
        text: 'Enjoy your meal hats!',
        buttons: [
          {
            text: 'Done',
            action: tour.complete,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.start();
    },
  },
};
</script>

<style lang="scss">
  .meal-hats-list {
    .meal-hats-list-body {
      max-width: 600px;
      margin: 0 auto;

      ul {
        list-style: none;
        padding: 0 32px;
        margin: 0;
      }

      .add-more-hats {
        border-top: 1px solid black;
        padding: 0 32px;

        @media screen and (min-width: 768px) {
          border: 0;
        }
      }

      .btn-secondary {
        font-size: 0.8rem;
      }
    }
  }

  /* #b02a37 rather than Bootstrap's .text-danger, which is too light on white. */
  .join-error {
    color: #b02a37;
    font-size: 0.85rem;
    padding: 0 32px;
    margin: 0.5rem 0 0;
  }

  .hat-members {
    border: 1px solid #dcdcdc;
    border-radius: 0 0 6px 6px;
    border-top: 0;
    padding: 0.5rem 0.75rem 0.75rem;
    text-align: left;

    .hat-members__list {
      list-style: none;
      margin: 0;
      padding: 0;

      li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.35rem 0;
        border-bottom: 1px solid #f0f0f0;
      }

      li:last-child {
        border-bottom: 0;
      }
    }

    .hat-members__who {
      font-size: 0.85rem;
      word-break: break-all;
    }

    .hat-members__you {
      background: #e6efe9;
      border-radius: 4px;
      color: #2f6f47;
      font-size: 0.7rem;
      margin-left: 0.35rem;
      padding: 0.1rem 0.3rem;
    }

    .hat-members__self-note {
      color: #9a9a9a;
      font-size: 0.7rem;
      white-space: nowrap;
    }

    .hat-members__status {
      color: #6a6a6a;
      font-size: 0.85rem;
      margin: 0.25rem 0;
    }

    .hat-members__hint {
      color: #6a6a6a;
      font-size: 0.72rem;
      margin: 0.5rem 0 0;
    }
  }
</style>