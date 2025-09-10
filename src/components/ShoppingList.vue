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

          <!-- Shopping List -->
          <div v-if="sortedShoppingList.length">
            <h3>Your Shopping List</h3>
            <ul class="list-group my-3" data-step="2">
              <li class="list-group-item" v-for="ingredient in sortedShoppingList" :key="ingredient.id">
                <!-- First line: Item name and quantity -->
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <span class="fw-bold">{{ ingredient.name }}</span>
                  <span>{{ ingredient.quantity }} {{ pluralizedUnits(ingredient) }}</span>
                </div>
                <!-- Second line: Aisle input and +/- buttons -->
                <div class="d-flex justify-content-between align-items-center">
                  <div class="d-flex align-items-center">
                    <label class="form-label me-2 mb-0 small text-muted">Aisle:</label>
                    <div class="input-group input-group-sm" style="width: 120px;" :data-step="ingredient === sortedShoppingList[0] ? '3' : undefined">
                      <input type="number" class="form-control" v-model.number="ingredient.aisle" @focus="showAisleButton(ingredient)" @blur="hideAisleButton(ingredient)" placeholder="##">
                      <button v-if="activeAisleInputs[ingredient.id]" class="btn btn-outline-secondary btn-sm" type="button" @click="updateGroceryItemAisle(ingredient)"><i class="bi bi-arrow-right"></i></button>
                    </div>
                  </div>
                  <div class="d-flex gap-2" :data-step="ingredient === sortedShoppingList[0] ? '4' : undefined">
                    <button class="btn btn-sm btn-tertiary" @click="increaseShoppingListQuantity(ingredient)">+1</button>
                    <button class="btn btn-sm btn-warning" @click="decreaseShoppingListQuantity(ingredient)">-1</button>
                  </div>
                </div>
              </li>
            </ul>
          </div>
          
          <!-- Empty State -->
          <div v-else class="text-center py-4 text-muted">
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
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import Header from '@/components/Header.vue';

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
      userInteracting: false
    }
  },
  mounted() {
    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.$refs.quickAddInput || !this.$refs.quickAddInput.contains(e.target)) {
        this.showSuggestions = false;
      }
    });
    
    // Protect against service worker reloads during user interaction
    this.setupReloadProtection();
  },
  computed: {
    // All existing grocery items for suggestions
    nonMealGroceryItems () {
      if (!this.$store.state.nonMealGroceryItems || !Object.keys(this.$store.state.nonMealGroceryItems).length) {
        return [];
      } else {
        return Object.keys(this.$store.state.nonMealGroceryItems)
          .map((key) => this.$store.state.nonMealGroceryItems[key])
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    },
    
    sortedShoppingList () {
      return [...this.$store.getters.unpurchasedIngredients].sort((a, b) => {
        if (!a.aisle && b.aisle) {
          return 1;
        } else if (a.aisle && !b.aisle) {
          return -1;
        } else if (!a.aisle && !b.aisle) {
          return 0;
        } else if (a.aisle < b.aisle) {
          return -1;
        } else if (a.aisle > b.aisle) {
          return 1;
        } else {
          return 0;
        }
      });
    }
  },
  methods: {
    // Update suggestions as user types
    updateSuggestions() {
      const query = this.quickAddInput.toLowerCase().trim();
      
      if (query.length === 0) {
        this.showSuggestions = false;
        this.filteredSuggestions = [];
        return;
      }

      this.filteredSuggestions = this.nonMealGroceryItems
        .filter(item => item.name.toLowerCase().includes(query))
        .slice(0, 5); // Show max 5 suggestions
      
      this.showSuggestions = this.filteredSuggestions.length > 0;
    },

    // Handle quick add (Enter key or Add button)
    handleQuickAdd() {
      const itemName = this.quickAddInput.trim();
      if (!itemName) return;

      // Check if this exact item already exists
      const existingItem = this.nonMealGroceryItems.find(
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
    selectSuggestion(suggestion) {
      this.addToShoppingList(suggestion);
      this.quickAddInput = '';
      this.showSuggestions = false;
    },

    // Show modal for new item details
    showNewItemModal(itemName) {
      this.pendingItemName = itemName;
      this.pendingQuantity = 1;
      this.pendingUnits = '';
      this.pendingAisle = null;
      
      // Show Bootstrap modal - try multiple ways to ensure compatibility
      this.$nextTick(() => {
        const modalEl = document.getElementById('quickDetailsModal');
        try {
          // Try using Bootstrap 5 syntax
          if (window.bootstrap && window.bootstrap.Modal) {
            const modal = new window.bootstrap.Modal(modalEl);
            modal.show();
          } else if (window.Bootstrap && window.Bootstrap.Modal) {
            const modal = new window.Bootstrap.Modal(modalEl);
            modal.show();
          } else {
            // Fallback: manually show modal
            modalEl.classList.add('show');
            modalEl.style.display = 'block';
            document.body.classList.add('modal-open');
          }
        } catch (error) {
          console.warn('Bootstrap modal failed, using fallback:', error);
          // Fallback: manually show modal
          modalEl.classList.add('show');
          modalEl.style.display = 'block';
          document.body.classList.add('modal-open');
        }
      });
    },

    // Confirm adding new item from modal
    confirmAddItem() {
      const newId = require('uuid').v4();
      
      // Create new grocery item object
      const newItem = {
        id: newId,
        name: this.pendingItemName,
        quantity: this.pendingQuantity || 1,
        units: this.pendingUnits || '',
        aisle: this.pendingAisle || 0
      };

      // Add to grocery items database for future use
      const nonMealGroceryEntry = {
        path: `non-meal-grocery-items/${newId}`,
        value: newItem
      };

      const groceryCatalogEntry = {
        path: `grocery-catalog/${newId}`,
        value: {
          id: newId,
          name: this.pendingItemName,
          defaultUnits: this.pendingUnits || '',
          defaultAisle: this.pendingAisle || 0
        }
      };

      this.$store.dispatch('updateDBValue', nonMealGroceryEntry);
      this.$store.dispatch('updateDBValue', groceryCatalogEntry);

      // Add to shopping list
      this.addToShoppingList(newItem);

      // Close modal and clear inputs
      const modalEl = document.getElementById('quickDetailsModal');
      try {
        if (window.bootstrap && window.bootstrap.Modal) {
          const modal = window.bootstrap.Modal.getInstance(modalEl);
          if (modal) {
            modal.hide();
          }
        } else {
          // Fallback: manually hide modal
          modalEl.classList.remove('show');
          modalEl.style.display = 'none';
          document.body.classList.remove('modal-open');
        }
      } catch (error) {
        // Fallback: manually hide modal
        modalEl.classList.remove('show');
        modalEl.style.display = 'none';
        document.body.classList.remove('modal-open');
      }
      this.quickAddInput = '';
      this.showSuggestions = false;
    },

    // Add item directly to shopping list
    addToShoppingList(item) {
      const nonMealShoppingList = this.$store.state.nonMealShoppingList;
      const existingItem = nonMealShoppingList ? nonMealShoppingList[item.id] : null;

      if (existingItem) {
        // If item already in shopping list, increase quantity
        const dbEntry = {
          path: `non-meal-shopping-list/${item.id}`,
          value: {
            ...existingItem,
            quantity: existingItem.quantity + (item.quantity || 1)
          }
        };
        this.$store.dispatch('updateDBValue', dbEntry);
      } else {
        // Add new item to shopping list
        const dbEntry = {
          path: `non-meal-shopping-list/${item.id}`,
          value: {
            id: item.id,
            name: item.name,
            aisle: item.aisle || item.defaultAisle || 0,
            quantity: item.quantity || 1,
            units: item.units || item.defaultUnits || ''
          }
        };
        this.$store.dispatch('updateDBValue', dbEntry);
      }

      // Clear input
      this.quickAddInput = '';
      this.showSuggestions = false;
    },

    // Increase item quantity in shopping list
    increaseShoppingListQuantity(item) {
      this.userInteracting = true;
      
      // Check if this is a non-meal item (manually added)
      const nonMealItem = this.$store.state.nonMealShoppingList && this.$store.state.nonMealShoppingList[item.id];
      
      if (nonMealItem) {
        // Update the non-meal shopping list item directly
        const dbEntry = {
          path: `non-meal-shopping-list/${item.id}`,
          value: {
            ...item,
            quantity: item.quantity + 1
          }
        };
        this.$store.dispatch('updateDBValue', dbEntry);
      } else {
        // This is a meal ingredient - decrease the purchased amount to show more on the list
        const currentPurchased = this.$store.state.purchasedIngredients[item.id] || 0;
        const newPurchased = currentPurchased - 1; // Allow negative values to show more than original quantity
        
        // Update purchased ingredients directly
        this.$store.state.purchasedIngredients[item.id] = newPurchased;
        
        // Save to database
        const dbEntry = {
          path: 'purchased-ingredients',
          value: this.$store.state.purchasedIngredients
        };
        this.$store.dispatch('updateDBValue', dbEntry);
      }
      
      // Clear interaction flag after operation
      setTimeout(() => {
        this.userInteracting = false;
      }, 500);
    },

    // Decrease item quantity in shopping list
    decreaseShoppingListQuantity (item) {
      this.userInteracting = true;
      
      // Check if this is a non-meal item (manually added)
      const nonMealItem = this.$store.state.nonMealShoppingList && this.$store.state.nonMealShoppingList[item.id];
      
      if (nonMealItem) {
        // Handle non-meal items directly
        if (item.quantity > 1) {
          const dbEntry = {
            path: `non-meal-shopping-list/${item.id}`,
            value: {
              ...item,
              quantity: item.quantity - 1
            }
          };
          this.$store.dispatch('updateDBValue', dbEntry);
        } else {
          // Remove item from list when quantity is 1
          const dbEntry = {
            path: `non-meal-shopping-list/${item.id}`,
            value: null
          };
          this.$store.dispatch('updateDBValue', dbEntry);
        }
      } else {
        // This is a meal ingredient - increase the purchased amount to show less on the list
        const currentPurchased = this.$store.state.purchasedIngredients[item.id] || 0;
        
        // Update purchased ingredients directly
        this.$store.state.purchasedIngredients[item.id] = currentPurchased + 1;
        
        // Save to database
        const dbEntry = {
          path: 'purchased-ingredients',
          value: this.$store.state.purchasedIngredients
        };
        this.$store.dispatch('updateDBValue', dbEntry);
      }
      
      // Clear interaction flag after operation
      setTimeout(() => {
        this.userInteracting = false;
      }, 500);
    },

    // Helper method to get corresponding item
    correspondingItemInNonMealGroceryItems (item) {
      const nonMealGroceryItems = this.$store.state.nonMealGroceryItems;
      return nonMealGroceryItems ? nonMealGroceryItems[item.id] : null
    },

    // Get default quantity for +/- buttons
    getDefaultQuantity (item) {
      const correspondingItem = this.correspondingItemInNonMealGroceryItems(item);
      return correspondingItem ? correspondingItem.quantity : 1;
    },
    // Show update button when input is focused
    showAisleButton(ingredient) {
      this.activeAisleInputs[ingredient.id] = true;
      this.userInteracting = true;
    },
    
    // Hide update button when input loses focus
    hideAisleButton(ingredient) {
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
    
    // Setup protection against service worker reloads
    setupReloadProtection() {
      // Create a flag to prevent reloads
      window.preventReload = false;
      
      // Override the reload by adding an event listener
      window.addEventListener('beforeunload', (e) => {
        if (this.userInteracting) {
          console.log('Preventing reload - user is actively editing shopping list');
          e.preventDefault();
          e.returnValue = '';
          return '';
        }
      });
      
      // Store original reload and create protected version
      const originalReload = window.location.reload.bind(window.location);
      
      // Create a custom reload function
      window.safeReload = () => {
        if (this.userInteracting) {
          console.log('Delaying reload - user is actively editing shopping list');
          this.scheduleDelayedReload();
        } else {
          originalReload();
        }
      };
      
      // Listen for service worker updates
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'SKIP_WAITING') {
            window.safeReload();
          }
        });
      }
    },
    
    // Schedule a delayed reload when user is done
    scheduleDelayedReload() {
      const checkAndReload = () => {
        if (!this.userInteracting) {
          console.log('User finished interacting - executing delayed reload');
          window.location.reload();
        } else {
          setTimeout(checkAndReload, 1000);
        }
      };
      setTimeout(checkAndReload, 1000);
    },

    updateGroceryItemAisle (ingredient) {
      // Check new unified grocery catalog first
      const isInGroceryCatalog = this.$store.state.groceryCatalog && this.$store.state.groceryCatalog[ingredient.id];
      // Fallback to old system
      const isGroceryItem = this.$store.state.groceryItems && Object.prototype.hasOwnProperty.call(this.$store.state.groceryItems, ingredient.id);
      const isNonMealGroceryItem = this.$store.state.nonMealGroceryItems && Object.prototype.hasOwnProperty.call(this.$store.state.nonMealGroceryItems, ingredient.id);

      let dbPath;
      if (isInGroceryCatalog) {
        // Update in new unified system
        dbPath = `grocery-catalog/${ingredient.id}/defaultAisle`;
      } else if (isGroceryItem) {
        // Update in old system
        dbPath = `grocery-items/${ingredient.id}/aisle`;
      } else if (isNonMealGroceryItem) {
        // Update in old system
        dbPath = `non-meal-grocery-items/${ingredient.id}/aisle`;
      } else {
        console.error('Ingredient not found in any grocery system:', ingredient);
        return;
      }

      const dbEntry = {
        path: dbPath,
        value: ingredient.aisle
      };

      this.$nextTick(() => {
        this.$store.dispatch('updateDBValue', dbEntry);
        // Hide the button after successful update
        this.activeAisleInputs[ingredient.id] = false;
      });
    },

    pluralizedUnits (ingredient) {
      if (!ingredient.units) return '';
      
      // Always pluralize based on the item's quantity
      return pluralize(ingredient.units, ingredient.quantity);
    },
    startTour () {
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
    margin: 0 auto;
    
    // Suggestions dropdown styling
    .suggestions-dropdown {
      position: relative;
      border: 1px solid #ced4da;
      border-top: none;
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
          border-bottom: none;
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
  }
}
</style>