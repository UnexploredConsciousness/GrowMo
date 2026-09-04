const catalog = [
  {
    id: 'basic-plan',
    name: 'Basic Plan',
    price: 19900, // ₹199 in paise
  },
  {
    id: 'premium-plan',
    name: 'Premium Plan',
    price: 49900, // ₹499 in paise
  },
  {
    id: 'consulting-session',
    name: '1-Hour Consulting Session',
    price: 150000, // ₹1500 in paise
  },
];

// Single source of truth for "does this item exist" —
// used by every route that needs to look up a catalog item.
function findCatalogItem(itemId) {
  return catalog.find((product) => product.id === itemId);
}

module.exports = { catalog, findCatalogItem };