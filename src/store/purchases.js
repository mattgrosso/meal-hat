// Carrying "I already bought this" across a shopping-list regeneration.
//
// The meal half of the shopping list is not edited, it is REBUILT: every row
// with source 'meal' is deleted and re-derived from the upcoming drawn meals,
// with a fresh uuid each time. That happens whenever meals are drawn, the
// schedule is reordered, a drawn meal is deleted, or a meal is scheduled from
// Show Meals.
//
// So marking a row purchased is not enough on its own — the row itself does not
// survive. The flag has to be re-applied to the newly built rows, and it has to
// be matched on groceryId, because the id is different every time.
//
// Pure on purpose: this is the rule, testable without Firebase.

/**
 * Re-apply `purchased` to freshly regenerated meal rows.
 *
 * `regenerated` are the new rows (each with groceryId + quantity).
 * `previousItems` is the shopping list as it stood before regeneration.
 *
 * A row stays bought only while what you bought still covers what is needed.
 * If a newly drawn meal pushes chicken from 2lb to 4lb, the 2lb you already
 * have does not cover it, so the item reopens rather than quietly staying
 * ticked and leaving you short at the shop.
 */
export function withPreservedPurchases (regenerated, previousItems) {
  const boughtQuantityByGrocery = new Map();

  (previousItems || []).forEach((item) => {
    if (!item || item.source !== 'meal' || !item.purchased) return;

    const quantity = Number(item.quantity) || 0;
    const known = boughtQuantityByGrocery.get(item.groceryId);

    // Defensive: the same grocery should only appear once per regeneration,
    // since aggregateMealIngredients sums by grocery id. If duplicates exist
    // from older data, the largest bought quantity is the honest reading.
    if (known === undefined || quantity > known) {
      boughtQuantityByGrocery.set(item.groceryId, quantity);
    }
  });

  return (regenerated || []).map((row) => {
    const bought = boughtQuantityByGrocery.get(row.groceryId);
    const stillCovered = bought !== undefined && (Number(row.quantity) || 0) <= bought;

    return { ...row, purchased: stillCovered };
  });
}
