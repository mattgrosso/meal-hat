<template>
  <div class="shopping-list">
    <Header headerText="Shopping List"/>
    <div class="shopping-list-body p-3">
      <div class="row">
        <div class="col-12">
          <!-- Quick Add Section -->
          <div class="my-3" data-step="1">
            <div class="input-group mb-2">
              <input
                type="text"
                class="form-control"
                placeholder="Add item to shopping list..."
                v-model="quickAddInput"
                @keyup.enter="handleQuickAdd"
                @input="updateSuggestions"
                ref="quickAddInput"
              >
              <button
                class="btn btn-primary"
                :disabled="!quickAddInput.trim()"
                @click="handleQuickAdd"
              >
                Add
              </button>
            </div>

            <!-- Suggestions Dropdown -->
            <div v-if="showSuggestions && filteredSuggestions.length" class="suggestions-dropdown">
              <div
                v-for="suggestion in filteredSuggestions"
                :key="suggestion.id"
                class="suggestion-item"
                @click="selectSuggestion(suggestion)"
              >
                <span class="suggestion-name">{{ suggestion.name }}</span>
                <span class="suggestion-details">{{ suggestion.quantity }} {{ suggestion.units }}</span>
              </div>
            </div>
          </div>

          <!-- Sort Toggle -->
          <div v-if="sortedShoppingList.length" class="d-flex gap-2 mb-3">
            <button
              class="btn btn-sm"
              :class="sortMode === 'aisle' ? 'btn-primary' : 'btn-outline-secondary'"
              @click="sortMode = 'aisle'"
            >Sort by Aisle</button>
            <button
              class="btn btn-sm"
              :class="sortMode === 'location' ? 'btn-primary' : 'btn-outline-secondary'"
              @click="sortMode = 'location'"
            >Sort by Home Location</button>
          </div>

          <!-- Shopping List -->
          <div v-if="sortedShoppingList.length">
            <h3>Your Shopping List</h3>
            <ul class="list-group my-3" data-step="2">
              <li class="list-group-item" v-for="ingredient in sortedShoppingList" :key="ingredient.id">
                <!-- First line: Item name and quantity -->
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <span class="fw-bold">
                    {{ ingredient.groceryItem ? ingredient.groceryItem.name : ingredient.name }}
                    <!-- A staple that came back says why, rather than just
                         reappearing without explanation. -->
                    <span v-if="ingredient.stapleDue" class="staple-due-note">
                      {{ ingredient.daysSincePurchase === null || ingredient.daysSincePurchase === undefined
                        ? 'staple — not bought yet'
                        : `staple — last bought ${ingredient.daysSincePurchase} days ago` }}
                    </span>
                  </span>
                  <span>{{ ingredient.quantity }} {{ pluralizedUnits(ingredient) }}</span>
                </div>
                <!-- Second line: Aisle input and location selector -->
                <div class="d-flex align-items-center gap-2 mb-2">
                  <label class="form-label me-1 mb-0 small text-muted">Aisle:</label>
                  <div class="input-group input-group-sm aisle-input-group" style="width: 120px;" :data-step="ingredient === sortedShoppingList[0] ? '3' : undefined">
                    <input type="number" class="form-control aisle-input" :value="ingredient.aisle" @focus="showAisleButton(ingredient)" @blur="handleAisleBlur" @input="updateAisleValue" placeholder="##">
                    <button v-if="activeAisleInputs[ingredient.id]" class="btn btn-outline-secondary btn-sm" type="button" @click="updateGroceryItemAisle(ingredient)"><i class="bi bi-arrow-right"></i></button>
                  </div>
                  <label class="form-label ms-2 me-1 mb-0 small text-muted">Location:</label>
                  <select
                    class="form-select form-select-sm location-select"
                    :value="ingredient.location || ''"
                    @change="updateItemLocation(ingredient, $event.target.value)"
                  >
                    <option value="">—</option>
                    <option value="upstairs">Upstairs</option>
                    <option value="downstairs">Downstairs</option>
                  </select>
                </div>
                <!-- Third line: +/- buttons -->
                <!-- Staple sits HERE rather than on the aisle/location line.
                     On a 402px phone that line was already using its full width:
                     adding a 52px control overflowed the row by 15px and
                     squeezed the aisle input from 72px down to 18px, which is
                     what "ruined the layout" meant. This line has three 40px
                     buttons and room to spare. -->
                <div class="d-flex justify-content-between align-items-center gap-2" :data-step="ingredient === sortedShoppingList[0] ? '4' : undefined">
                  <label class="staple-toggle" :title="stapleTitle(ingredient)">
                    <input type="checkbox" :checked="isStaple(ingredient)" @change="toggleStaple(ingredient, $event.target.checked)">
                    <span>Staple</span>
                  </label>
                  <span class="d-flex gap-2">
                  <button class="btn btn-sm btn-primary" @click="increaseShoppingListQuantity(ingredient)" style="width: 40px;">+1</button>
                  <button class="btn btn-sm btn-secondary" @click="decreaseShoppingListQuantity(ingredient)" style="width: 40px;">-1</button>
                  <!-- Marks it bought rather than deleting it. Same gesture and
                       the same immediate result — it leaves the list — but it is
                       now recorded, so a regeneration cannot bring it back. -->
                  <button class="btn btn-sm btn-success" title="Got it" aria-label="Got it" @click="markPurchased(ingredient)" style="width: 40px;"><i class="bi bi-check-lg" style="font-size: 1.2em;"></i></button>
                  </span>
                </div>
              </li>
            </ul>
          </div>

          <!-- In the cupboard: staples bought recently enough that you should
               already have them. NOT hidden and NOT deleted — the rows are
               intact, and each one can be pulled onto the list in a tap. They
               also return on their own once past their interval. -->
          <div v-if="cupboardItems.length" class="cupboard-section my-3" data-step="5">
            <button type="button" class="cupboard-toggle" @click="showCupboard = !showCupboard">
              <i :class="showCupboard ? 'bi bi-chevron-down' : 'bi bi-chevron-right'"></i>
              In the cupboard ({{ cupboardItems.length }})
            </button>

            <ul v-if="showCupboard" class="list-group my-2">
              <li class="list-group-item d-flex justify-content-between align-items-center cupboard-item" v-for="ingredient in cupboardItems" :key="ingredient.id">
                <span>
                  {{ ingredient.groceryItem ? ingredient.groceryItem.name : ingredient.name }}
                  <span class="cupboard-meta">
                    {{ ingredient.daysSincePurchase === null || ingredient.daysSincePurchase === undefined
                      ? 'no purchase recorded'
                      : `bought ${ingredient.daysSincePurchase} days ago` }}
                  </span>
                </span>
                <button class="btn btn-sm btn-outline-secondary" title="Add to the list anyway" aria-label="Add to the list anyway" @click="needStapleNow(ingredient)">
                  Need it
                </button>
              </li>
            </ul>
          </div>

          <!-- Bought. Collapsed by default: this is a record, not a worklist.
               Meal-sourced rows clear themselves once their meal is in the past,
               because regeneration stops deriving them. -->
          <div v-if="purchasedItems.length" class="purchased-section my-3" :data-step="cupboardItems.length ? null : '5'">
            <button type="button" class="purchased-toggle" @click="showPurchased = !showPurchased">
              <i :class="showPurchased ? 'bi bi-chevron-down' : 'bi bi-chevron-right'"></i>
              Bought ({{ purchasedItems.length }})
            </button>

            <ul v-if="showPurchased" class="list-group my-2">
              <li class="list-group-item d-flex justify-content-between align-items-center purchased-item" v-for="ingredient in purchasedItems" :key="ingredient.id">
                <span>{{ ingredient.groceryItem ? ingredient.groceryItem.name : ingredient.name }}</span>
                <span class="d-flex align-items-center gap-2">
                  <span class="small">{{ ingredient.quantity }} {{ pluralizedUnits(ingredient) }}</span>
                  <button class="btn btn-sm btn-outline-secondary" title="Put it back" aria-label="Put it back" @click="unmarkPurchased(ingredient)">
                    <i class="bi bi-arrow-counterclockwise"></i>
                  </button>
                </span>
              </li>
            </ul>
          </div>

          <!-- Empty State. Conditions spelled out rather than chained with
               v-else: the bought section sits between this and the list, so an
               v-else would attach to the wrong sibling. -->
          <div v-if="!sortedShoppingList.length && !purchasedItems.length" class="text-center py-4 text-muted">
            <i class="bi bi-cart3" style="font-size: 3rem; opacity: 0.5;"></i>
            <p class="mt-2">Start typing to add items to your shopping list</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Details Modal -->
    <div class="modal fade" id="quickDetailsModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Add "{{ pendingItemName }}"</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="row g-2">
              <div class="col-6">
                <label class="form-label">Quantity</label>
                <input type="number" class="form-control" v-model="pendingQuantity" min="1">
              </div>
              <div class="col-6">
                <label class="form-label">Units</label>
                <input type="text" class="form-control" v-model="pendingUnits" placeholder="lbs, cans, etc.">
              </div>
              <div class="col-12">
                <label class="form-label">Aisle (optional)</label>
                <input type="number" class="form-control" v-model="pendingAisle" placeholder="Aisle number">
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" @click="confirmAddItem">Add to List</button>
          </div>
        </div>
      </div>
    </div>

    <span class="start-tour-button" @click="this.startTour()">
      <i class="bi bi-question-circle"/>
    </span>
  </div>
</template>

<script>
import pluralize from 'pluralize';
import { Modal } from 'bootstrap';
// Shepherd is loaded ON DEMAND, inside startTour().
//
// It was a static import here and in five other components, so the tour library
// and its stylesheet were downloaded by every visit — to power a "?" button most
// visits never press.
import Header from '@/components/Header.vue';
import { partitionStaples } from '@/store/staples';
import { todayISO } from '@/store/schedule';

export default {
  name: 'ShoppingList',
  components: {
    Header
  },
  data () {
    return {
      // Quick add functionality
      quickAddInput: '',
      showSuggestions: false,
      filteredSuggestions: [],

      // Modal data for new items
      pendingItemName: '',
      pendingQuantity: 1,
      pendingUnits: '',
      pendingAisle: null,

      // Track which aisle inputs are being used
      activeAisleInputs: {},

      // Track if user is actively interacting with the shopping list
      userInteracting: false,

      // Temporarily store aisle value while editing
      tempAisleValue: undefined,

      // Sort mode: 'aisle' or 'location'
      sortMode: 'aisle',

      // The bought list is a record you occasionally need, not part of shopping.
      showPurchased: false,

      // Same for the cupboard: a reassurance, not a worklist.
      showCupboard: false,

      // Staples the user has explicitly pulled onto this list despite being in
      // the cupboard. Session-only on purpose — "I'm out of olive oil" is about
      // this shopping trip, and marking it bought records the real answer.
      forcedOntoList: []
    }
  },
  async mounted () {
    // Close suggestions when clicking outside
    this.handleDocumentClick = (e) => {
      if (!this.$refs.quickAddInput || !this.$refs.quickAddInput.contains(e.target)) {
        this.showSuggestions = false;
      }
    };
    document.addEventListener('click', this.handleDocumentClick);

    // Protect against service worker reloads during user interaction
    this.setupReloadProtection();
  },
  beforeUnmount () {
    // Remove the listeners added in mounted / setupReloadProtection so they don't
    // accumulate on every visit to this page.
    document.removeEventListener('click', this.handleDocumentClick);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    if (this.handleServiceWorkerMessage && 'serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', this.handleServiceWorkerMessage);
    }
  },
  computed: {
    // All catalog grocery items, for the quick-add suggestions.
    groceryItems () {
      const catalog = this.$store.state.groceryCatalog || {};
      return Object.values(catalog).sort((a, b) => a.name.localeCompare(b.name));
    },

    purchasedItems () {
      return this.$store.getters.shoppingListItems
        .filter((item) => item.purchased)
        .sort((a, b) => {
          const left = a.groceryItem ? a.groceryItem.name : (a.name || '');
          const right = b.groceryItem ? b.groceryItem.name : (b.name || '');
          return left.localeCompare(right);
        });
    },

    // Staples split off here, and ONLY here — nothing is removed from the
    // stored list, so a mistake in this rule can misplace an item but never
    // lose one.
    stapleSplit () {
      const { list, cupboard } = partitionStaples(
        this.$store.getters.unpurchasedShoppingItems,
        this.$store.state.groceryCatalog || {}
      );

      // Anything explicitly asked for this session goes back on the list.
      const forced = new Set(this.forcedOntoList);
      const pulled = cupboard.filter((item) => forced.has(item.groceryId));

      return {
        list: [...list, ...pulled],
        cupboard: cupboard.filter((item) => !forced.has(item.groceryId))
      };
    },

    cupboardItems () {
      return this.stapleSplit.cupboard;
    },

    sortedShoppingList () {
      const items = [...this.stapleSplit.list];
      if (this.sortMode === 'location') {
        const order = { upstairs: 0, downstairs: 1 };
        return items.sort((a, b) => {
          const aHas = a.location in order;
          const bHas = b.location in order;
          if (!aHas && !bHas) return 0;
          if (!aHas) return -1;
          if (!bHas) return 1;
          return order[a.location] - order[b.location];
        });
      }
      return items.sort((a, b) => {
        if (!a.aisle && b.aisle) return 1;
        if (a.aisle && !b.aisle) return -1;
        if (!a.aisle && !b.aisle) return 0;
        return a.aisle - b.aisle;
      });
    }
  },
  methods: {
    // Update suggestions as user types
    updateSuggestions () {
      const query = this.quickAddInput.toLowerCase().trim();

      if (query.length === 0) {
        this.showSuggestions = false;
        this.filteredSuggestions = [];
        return;
      }

      this.filteredSuggestions = this.groceryItems
        .filter(item => item.name.toLowerCase().includes(query))
        .slice(0, 5); // Show max 5 suggestions

      this.showSuggestions = this.filteredSuggestions.length > 0;
    },

    // Handle quick add (Enter key or Add button)
    handleQuickAdd () {
      const itemName = this.quickAddInput.trim();
      if (!itemName) return;

      // Check if this exact item already exists
      const existingItem = this.groceryItems.find(
        item => item.name.toLowerCase() === itemName.toLowerCase()
      );

      if (existingItem) {
        // Use existing item with its stored details
        this.addToShoppingList(existingItem);
      } else {
        // New item - show modal for details
        this.showNewItemModal(itemName);
      }
    },

    // Select item from suggestions dropdown
    selectSuggestion (suggestion) {
      this.addToShoppingList(suggestion);
      this.quickAddInput = '';
      this.showSuggestions = false;
    },

    // Show modal for new item details
    showNewItemModal (itemName) {
      this.pendingItemName = itemName;
      this.pendingQuantity = 1;
      this.pendingUnits = '';
      this.pendingAisle = null;

      // Use Bootstrap's Modal API directly. Relying on a global window.bootstrap
      // (which our ESM build never sets) forced a manual show that Bootstrap's own
      // data-bs-dismiss handler then couldn't close, leaving the modal stuck on top
      // of the page and the whole screen unresponsive.
      this.$nextTick(() => {
        const modalEl = document.getElementById('quickDetailsModal');
        Modal.getOrCreateInstance(modalEl).show();
      });
    },

    // Confirm adding new item from modal
    confirmAddItem () {
      const groceryId = require('uuid').v4();

      // Create grocery catalog entry
      const groceryCatalogItem = {
        id: groceryId,
        name: this.pendingItemName,
        defaultUnits: this.pendingUnits || '',
        defaultAisle: this.pendingAisle || 0
      };

      // Update local grocery catalog state immediately
      this.$store.state.groceryCatalog[groceryId] = groceryCatalogItem;

      // Save grocery catalog entry to database
      const groceryCatalogEntry = {
        path: `grocery-catalog/${groceryId}`,
        value: groceryCatalogItem
      };
      this.$store.dispatch('updateDBValue', groceryCatalogEntry);

      // Create item object for adding to shopping list
      const newItem = {
        id: groceryId,
        name: this.pendingItemName,
        quantity: this.pendingQuantity || 1,
        defaultUnits: this.pendingUnits || '',
        defaultAisle: this.pendingAisle || 0
      };

      // Add to shopping list
      this.addToShoppingList(newItem);

      // Close modal and clear inputs
      const modalEl = document.getElementById('quickDetailsModal');
      Modal.getOrCreateInstance(modalEl).hide();
      this.quickAddInput = '';
      this.showSuggestions = false;
    },

    // Add item directly to shopping list
    addToShoppingList (item) {
      const shoppingList = this.$store.state.shoppingList;
      // Find existing item by groceryId (not id)
      const existingItem = shoppingList ? Object.values(shoppingList).find(listItem => listItem.groceryId === item.id) : null;
      const shoppingItemId = require('uuid').v4();

      if (existingItem) {
        // If item already in shopping list, increase quantity
        const updatedItem = {
          ...existingItem,
          quantity: existingItem.quantity + (item.quantity || 1)
        };

        // Update local state immediately
        this.$store.state.shoppingList[existingItem.id] = updatedItem;

        // Update database
        const dbEntry = {
          path: `shopping-list/${existingItem.id}`,
          value: updatedItem
        };
        this.$store.dispatch('updateDBValue', dbEntry);
      } else {
        // Add new item to unified shopping list
        const catalogEntry = this.$store.state.groceryCatalog && this.$store.state.groceryCatalog[item.id];
        const newItem = {
          id: shoppingItemId,
          groceryId: item.id,
          quantity: item.quantity || 1,
          units: item.units || item.defaultUnits || '',
          aisle: item.aisle || item.defaultAisle || 0,
          location: item.location || (catalogEntry && catalogEntry.defaultLocation) || null,
          source: 'manual',
          purchased: false
        };

        // Update local state immediately
        this.$store.state.shoppingList[shoppingItemId] = newItem;

        // Update database
        const dbEntry = {
          path: `shopping-list/${shoppingItemId}`,
          value: newItem
        };
        this.$store.dispatch('updateDBValue', dbEntry);
      }

      // Clear input
      this.quickAddInput = '';
      this.showSuggestions = false;
    },

    // Increase item quantity in shopping list
    increaseShoppingListQuantity (item) {
      this.userInteracting = true;

      // Update the unified shopping list item directly
      const dbEntry = {
        path: `shopping-list/${item.id}`,
        value: {
          ...item,
          quantity: item.quantity + 1
        }
      };
      this.$store.dispatch('updateDBValue', dbEntry);

      // Clear interaction flag after operation
      setTimeout(() => {
        this.userInteracting = false;
      }, 500);
    },

    // Decrease item quantity in shopping list
    decreaseShoppingListQuantity (item) {
      this.userInteracting = true;

      if (item.quantity > 1) {
        // Decrease quantity
        const dbEntry = {
          path: `shopping-list/${item.id}`,
          value: {
            ...item,
            quantity: item.quantity - 1
          }
        };
        this.$store.dispatch('updateDBValue', dbEntry);
      } else {
        // Remove item from list when quantity is 1
        const dbEntry = {
          path: `shopping-list/${item.id}`,
          value: null
        };
        this.$store.dispatch('updateDBValue', dbEntry);
      }

      // Clear interaction flag after operation
      setTimeout(() => {
        this.userInteracting = false;
      }, 500);
    },

    // Remove item entirely from shopping list
    isStaple (item) {
      return Boolean((this.$store.state.groceryCatalog || {})[item.groceryId]?.staple);
    },
    stapleTitle (item) {
      return this.isStaple(item)
        ? 'A staple — kept in the cupboard section until it is due again'
        : 'Mark as something you always have';
    },
    // Staple-ness belongs to the grocery, not to this week's row, so it is
    // written to the catalog — the same place aisle and location defaults go.
    toggleStaple (item, staple) {
      const entry = (this.$store.state.groceryCatalog || {})[item.groceryId];
      if (!entry) return;

      this.$store.dispatch('updateDBValue', {
        path: `grocery-catalog/${item.groceryId}`,
        value: { ...entry, staple }
      });
    },
    // "I'm out of it after all." Session-scoped: it puts the row back on this
    // list without editing the grocery, and ticking it off records the real
    // purchase date, which is what actually resets the cycle.
    needStapleNow (item) {
      if (!this.forcedOntoList.includes(item.groceryId)) {
        this.forcedOntoList.push(item.groceryId);
      }
    },

    // Mark bought. Deliberately NOT a delete.
    //
    // Deleting was the old behaviour and it did not stick: the meal half of the
    // list is rebuilt from the upcoming schedule whenever meals are drawn, the
    // schedule is reordered, a drawn meal is deleted, or one is scheduled from
    // Show Meals. A deletion was never an input to that calculation, so anything
    // bought for a still-upcoming meal simply came back. Manual items stayed
    // gone, which meant the same gesture quietly did two different things.
    markPurchased (item) {
      this.setPurchased(item, true);
    },
    unmarkPurchased (item) {
      this.setPurchased(item, false);
    },
    setPurchased (item, purchased) {
      this.userInteracting = true;

      const updated = { ...item, purchased };
      delete updated.groceryItem; // a read-time join, never persisted
      delete updated.stapleDue; // presentation only, derived on read
      delete updated.daysSincePurchase;

      this.$store.dispatch('updateDBValue', {
        path: `shopping-list/${item.id}`,
        value: updated
      });

      // Record WHEN it was bought, on the grocery itself. This is what lets a
      // staple settle down and, more importantly, come back later — without it
      // a staple would be hidden forever, which is exactly the failure mode
      // this feature must not have.
      if (purchased) {
        const entry = (this.$store.state.groceryCatalog || {})[item.groceryId];
        if (entry) {
          this.$store.dispatch('updateDBValue', {
            path: `grocery-catalog/${item.groceryId}`,
            value: { ...entry, lastPurchased: todayISO() }
          });
        }
        // No longer forced onto the list — it has been dealt with.
        this.forcedOntoList = this.forcedOntoList.filter((id) => id !== item.groceryId);
      }

      // Clear interaction flag after operation
      setTimeout(() => {
        this.userInteracting = false;
      }, 500);
    },

    // Show update button when input is focused
    showAisleButton (ingredient) {
      this.activeAisleInputs[ingredient.id] = true;
      this.userInteracting = true;
    },

    // Hide update button when input loses focus
    hideAisleButton (ingredient) {
      // Delay hiding to allow button click
      setTimeout(() => {
        this.activeAisleInputs[ingredient.id] = false;
        // Check if any inputs are still active
        const hasActiveInputs = Object.values(this.activeAisleInputs).some(active => active);
        if (!hasActiveInputs) {
          this.userInteracting = false;
        }
      }, 150);
    },

    // Track aisle input changes
    updateAisleValue (event) {
      // Store the value temporarily - we'll save it on blur
      this.tempAisleValue = parseFloat(event.target.value) || 0;
    },

    // Handle blur event on aisle input - update aisle AND hide button
    handleAisleBlur (event) {
      const ingredient = this.getIngredientFromInputEvent(event);
      if (ingredient && this.tempAisleValue !== undefined) {
        // Update the ingredient's aisle value
        ingredient.aisle = this.tempAisleValue;
        // Save to database
        this.updateGroceryItemAisle(ingredient);
      }
      // Hide the button
      this.hideAisleButton(ingredient);
      this.tempAisleValue = undefined;
    },

    // Helper to find ingredient from input event
    getIngredientFromInputEvent (event) {
      const inputElement = event.target;
      // Find the ingredient by looking at the input's data or closest list item
      const listItem = inputElement.closest('li');
      const ingredientIndex = Array.from(listItem.parentElement.children).indexOf(listItem);
      return this.sortedShoppingList[ingredientIndex];
    },

    // Setup protection against service worker reloads
    setupReloadProtection () {
      // Create a flag to prevent reloads
      window.preventReload = false;

      // Override the reload by adding an event listener
      this.handleBeforeUnload = (e) => {
        if (this.userInteracting) {
          e.preventDefault();
          e.returnValue = '';
          return '';
        }
      };
      window.addEventListener('beforeunload', this.handleBeforeUnload);

      // Store original reload and create protected version
      const originalReload = window.location.reload.bind(window.location);

      // Create a custom reload function
      window.safeReload = () => {
        if (this.userInteracting) {
          this.scheduleDelayedReload();
        } else {
          originalReload();
        }
      };

      // Listen for service worker updates
      if ('serviceWorker' in navigator) {
        this.handleServiceWorkerMessage = (event) => {
          if (event.data && event.data.type === 'SKIP_WAITING') {
            window.safeReload();
          }
        };
        navigator.serviceWorker.addEventListener('message', this.handleServiceWorkerMessage);
      }
    },

    // Schedule a delayed reload when user is done
    scheduleDelayedReload () {
      const checkAndReload = () => {
        if (!this.userInteracting) {
          window.location.reload();
        } else {
          setTimeout(checkAndReload, 1000);
        }
      };
      setTimeout(checkAndReload, 1000);
    },

    updateItemLocation (ingredient, location) {
      const updatedItem = { ...ingredient, location: location || null };

      // Update local shopping list state
      this.$store.state.shoppingList[ingredient.id] = updatedItem;

      // Persist shopping list item
      this.$store.dispatch('updateDBValue', {
        path: `shopping-list/${ingredient.id}`,
        value: updatedItem
      });

      // Also persist as defaultLocation on the grocery catalog entry
      const groceryId = ingredient.groceryId;
      if (groceryId && this.$store.state.groceryCatalog && this.$store.state.groceryCatalog[groceryId]) {
        this.$store.state.groceryCatalog[groceryId].defaultLocation = location || null;
        this.$store.dispatch('updateDBValue', {
          path: `grocery-catalog/${groceryId}/defaultLocation`,
          value: location || null
        });
      }
    },

    updateGroceryItemAisle (ingredient) {
      // Update the local state immediately
      const updatedIngredient = {
        ...ingredient,
        aisle: ingredient.aisle
      };

      // Update in local shopping list state
      if (this.$store.state.shoppingList[ingredient.id]) {
        this.$store.state.shoppingList[ingredient.id] = updatedIngredient;
      }

      // Update the shopping list item in database
      const shoppingListEntry = {
        path: `shopping-list/${ingredient.id}`,
        value: updatedIngredient
      };
      this.$store.dispatch('updateDBValue', shoppingListEntry);

      // Also update the grocery catalog default aisle for future items
      const groceryId = ingredient.groceryId;
      if (groceryId && this.$store.state.groceryCatalog && this.$store.state.groceryCatalog[groceryId]) {
        // Update local grocery catalog state
        this.$store.state.groceryCatalog[groceryId].defaultAisle = ingredient.aisle;

        const catalogEntry = {
          path: `grocery-catalog/${groceryId}/defaultAisle`,
          value: ingredient.aisle
        };
        this.$store.dispatch('updateDBValue', catalogEntry);
      }

      this.$nextTick(() => {
        // Hide the button after successful update
        this.activeAisleInputs[ingredient.id] = false;
      });
    },

    pluralizedUnits (ingredient) {
      if (!ingredient.units) return '';

      // Always pluralize based on the item's quantity
      return pluralize(ingredient.units, ingredient.quantity);
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
        title: 'Shopping List - Now Enhanced!',
        text: 'Your shopping list now includes both ingredients from your meals and items you can add directly. Plus easy quantity adjustments for when you already have some items at home!',
        buttons: [
          {
            text: 'Next',
            action: tour.next,
            classes: 'btn-success btn btn-sm'
          }
        ]
      });

      tour.addStep({
        title: 'Quick Add Items',
        text: 'Type any grocery item to add it to your shopping list. If you\'ve used it before, it will suggest it with saved details. Press Enter or click Add.',
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
        title: 'Your Shopping List',
        text: 'This shows all items you need - from meals and items you added directly. Items are sorted by aisle number to make shopping easier.',
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
        title: 'Aisle Numbers',
        text: 'Edit aisle numbers to match your store layout. Your list will automatically sort by aisle to make shopping efficient.',
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

      tour.addStep({
        title: 'Quantity Controls',
        text: 'Use + to add more of an item, or - to reduce the quantity if you already have some at home. The - button will remove the item entirely when quantity reaches zero.',
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

      // Only when the section is actually on screen: both the cupboard and the
      // bought list are conditional, and Shepherd cannot attach a step to an
      // element that is not rendered. Same guard MealHats uses for its delete
      // step.
      if (document.querySelector('[data-step="5"]')) {
        tour.addStep({
          title: 'Bought, and the cupboard',
          text: 'Things you tick off collect under "Bought", where you can put one back if you tapped it by mistake. Staples you already have sit under "In the cupboard" — they come back to the list on their own once it has been a while, so you will not quietly run out.',
          attachTo: {
            element: '[data-step="5"]',
            on: 'top'
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

      // Closing step, matching every other screen's tour. It is also what lets
      // the step above be optional without leaving the tour ending on a "Next"
      // that goes nowhere.
      tour.addStep({
        title: 'That\'s all',
        text: 'Happy shopping!',
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
.shopping-list {
  .shopping-list-body {
    max-width: 600px;
    margin: 0 auto 30vh;

    // Suggestions dropdown styling
    .suggestions-dropdown {
      position: relative;
      border: 1px solid #ced4da;
      border-top: 0;
      border-radius: 0 0 0.375rem 0.375rem;
      background: white;
      box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
      z-index: 1000;

      .suggestion-item {
        padding: 0.75rem;
        cursor: pointer;
        border-bottom: 1px solid #eee;
        display: flex;
        justify-content: space-between;
        align-items: center;

        &:hover {
          background-color: #f8f9fa;
        }

        &:last-child {
          border-bottom: 0;
        }

        .suggestion-name {
          font-weight: 500;
          color: #212529;
        }

        .suggestion-details {
          font-size: 0.875rem;
          color: #6c757d;
        }
      }
    }

    // Empty state styling
    .text-muted {
      i {
        display: block;
        margin-bottom: 1rem;
      }
    }

    // Modal styling
    .modal-content {
      border-radius: 0.5rem;
    }

    // Prevent iOS zoom on aisle inputs
    .aisle-input {
      font-size: 16px !important;
    }

    .location-select {
      font-size: 16px !important;
      width: auto;
    }
  }
}

  /* Bought items: present but plainly secondary to what is still to buy. */
  .purchased-section {
    .purchased-toggle {
      background: none;
      border: 0;
      padding: 0.25rem 0;
      color: #6a6a6a;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      /* Small to look at, big to tap. */
      min-height: 40px;
    }

    .purchased-toggle:active {
      color: #212529;
    }

    .purchased-item {
      color: #6a6a6a;
      text-decoration: line-through;
      text-decoration-color: #b9b9b9;
    }

    /* The undo control is not struck through — it is an action, not a record. */
    .purchased-item .btn {
      text-decoration: none;
    }
  }

  .staple-toggle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: #6a6a6a;
    white-space: nowrap;
    /* Small text, but the label and box together clear the tap minimum. */
    min-height: 40px;
  }

  .staple-due-note {
    display: block;
    font-size: 0.7rem;
    font-weight: 400;
    /* #7a6a2a on white is ~5.5:1 — readable, and not the same green as the
       affirmative buttons. */
    color: #7a6a2a;
  }

  /* The cupboard is reassurance, not a worklist — quieter than the real list. */
  .cupboard-section {
    .cupboard-toggle {
      background: none;
      border: 0;
      padding: 0.25rem 0;
      color: #6a6a6a;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 40px;
    }

    .cupboard-toggle:active {
      color: #212529;
    }

    .cupboard-item {
      color: #6a6a6a;
    }

    .cupboard-meta {
      display: block;
      font-size: 0.7rem;
      color: #9a9a9a;
    }
  }
</style>