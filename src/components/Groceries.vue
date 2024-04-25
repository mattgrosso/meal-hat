<template>
  <div class="groceries">
    <Header headerText="Groceries"/>
    <div class="container">
      <div class="row">
        <div class="col-12">
          <div class="my-3">
            <div class="input-group mb-1">
              <input type="text" class="form-control" placeholder="New Grocery Item" v-model="newGroceryItemName">
            </div>
            <div class="input-group">
              <input type="number" class="form-control" style="flex: 2;" placeholder="Quantity" v-model="newGroceryItemQuantity">
              <input type="text" class="form-control" style="flex: 0.5;" placeholder="Units" v-model="newGroceryItemUnits">
              <input type="number" class="form-control" style="flex: 0.5;" placeholder="Aisle" v-model="newGroceryItemAisle">
              <button class="btn btn-primary" :disabled="!newGroceryItemName" @click="addGroceryItemToNonMealGroceryItems">Add</button>
            </div>
          </div>

          <hr>

          <div class="input-group my-3">
            <input type="text" class="form-control" placeholder="Search Existing Items" v-model="searchText">
            <button class="btn btn-secondary" @click="searchText = ''" v-if="searchText">Clear</button>
          </div>

          <hr v-if="filteredGroceryItems.length" >
          <h3 v-if="filteredGroceryItems.length" >Grocery Items</h3>
          <ul class="list-group my-3">
            <li class="list-group-item d-flex justify-content-between align-items-center" v-for="item in filteredGroceryItems" :key="item.id" @click="toggleDeleteButton(item)">
              <span>{{item.name}}</span>
              <div>
                <button v-if="showDeleteButton === item.id" class="btn btn-sm btn-danger" @click.stop="deleteItem(item)">Delete</button>
                <button v-else class="btn btn-sm btn-primary mr-2" @click.stop="increaseShoppingListQuantity(item)">+{{item.quantity}} {{item.units}}</button>
              </div>
            </li>
          </ul>

          <hr v-if="sortedShoppingList.length">
          <h3 v-if="sortedShoppingList.length">Shopping List</h3>
          <ul class="list-group my-3">
            <li class="list-group-item d-flex justify-content-between align-items-center" v-for="item in sortedShoppingList" :key="item.id">
              <span>{{item.name}} - Quantity: {{item.quantity}}</span>
              <button class="btn btn-sm btn-warning" @click="decreaseShoppingListQuantity(item)">-{{getDefaultQuantity(item)}} {{ getUnits(item)}}</button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import Header from '@/components/Header.vue';
import pluralize from 'pluralize';

export default {
  data () {
    return {
      showDeleteButton: null,
      newGroceryItemName: '',
      newGroceryItemQuantity: null,
      newGroceryItemUnits: '',
      newGroceryItemAisle: null,
      searchText: ''
    }
  },
  components: {
    Header
  },
  computed: {
    nonMealGroceryItems () {
      if (!this.$store.state.nonMealGroceryItems || !Object.keys(this.$store.state.nonMealGroceryItems).length) {
        return [];
      } else {
        return Object.keys(this.$store.state.nonMealGroceryItems).map((key) => this.$store.state.nonMealGroceryItems[key]);
      }
    },
    nonMealShoppingList () {
      if (!this.$store.state.nonMealShoppingList || !Object.keys(this.$store.state.nonMealShoppingList).length) {
        return [];
      } else {
        return Object.keys(this.$store.state.nonMealShoppingList).map((key) => this.$store.state.nonMealShoppingList[key]);
      }
    },
    filteredGroceryItems () {
      return this.nonMealGroceryItems.filter(item => item.name.toLowerCase().includes(this.searchText.toLowerCase()));
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
    addGroceryItemToNonMealGroceryItems () {
      const dbEntry = {
        path: `non-meal-grocery-items`,
        value: {
          name: this.newGroceryItemName,
          units: this.newGroceryItemUnits,
          aisle: this.newGroceryItemAisle || 0,
          quantity: this.newGroceryItemQuantity || 1
        }
      }

      this.$store.dispatch('setDBValue', dbEntry);
      this.newGroceryItemName = '';
      this.newGroceryItemQuantity = null;
      this.newGroceryItemUnits = '';
      this.newGroceryItemAisle = null;
    },
    toggleDeleteButton (item) {
      if (this.showDeleteButton === item.id) {
        this.showDeleteButton = null;
      } else {
        this.showDeleteButton = item.id;
      }
    },
    deleteItem (item) {
      const dbEntry = {
        path: `non-meal-grocery-items/${item.id}`,
        value: null
      };

      this.$store.dispatch('updateDBValue', dbEntry);
    },
    correspondingItemInNonMealGroceryItems (item) {
      const nonMealGroceryItems = this.$store.state.nonMealGroceryItems;

      return nonMealGroceryItems ? nonMealGroceryItems[item.id] : null
    },
    increaseShoppingListQuantity (item) {
      const nonMealShoppingList = this.$store.state.nonMealShoppingList;
      const existingItem = nonMealShoppingList ? nonMealShoppingList[item.id] : null;

      if (existingItem) {
        // If the item is already in the shopping list, increase its quantity
        const dbEntry = {
          path: `non-meal-shopping-list/${item.id}`,
          value: {
            ...existingItem,
            quantity: existingItem.quantity + item.quantity
          }
        };

        this.$store.dispatch('updateDBValue', dbEntry);
      } else {
        // If the item is not in the shopping list, add it
        const dbEntry = {
          path: `non-meal-shopping-list/${item.id}`,
          value: {
            id: item.id,
            name: item.name,
            aisle: item.aisle,
            quantity: item.quantity
          }
        };

        this.$store.dispatch('updateDBValue', dbEntry);
      }
    },
    decreaseShoppingListQuantity (item) {
      const correspondingItem = this.correspondingItemInNonMealGroceryItems(item);

      if (correspondingItem && item.quantity > correspondingItem.quantity) {
        // If the corresponding item exists and the item quantity is greater than the corresponding item quantity, decrease the item quantity
        const dbEntry = {
          path: `non-meal-shopping-list/${item.id}`,
          value: {
            ...item,
            quantity: item.quantity - correspondingItem.quantity
          }
        };

        this.$store.dispatch('updateDBValue', dbEntry);
      } else {
        // If the corresponding item does not exist or the item quantity is not greater than the corresponding item quantity, remove the item from the shopping list
        const dbEntry = {
          path: `non-meal-shopping-list/${item.id}`,
          value: null
        };

        this.$store.dispatch('updateDBValue', dbEntry);
      }
    },
    getDefaultQuantity (item) {
      const correspondingItem = this.correspondingItemInNonMealGroceryItems(item);

      return correspondingItem ? correspondingItem.quantity : 1;
    },
    getUnits (item) {
      if (!item.units) {
        const itemInNonMealGroceryItems = this.correspondingItemInNonMealGroceryItems(item);

        return itemInNonMealGroceryItems ? itemInNonMealGroceryItems.units : '';
      } else {
        return pluralize(item.units, item.quantity);
      }
    }
  },
};
</script>

<style lang="scss">

</style>