/**
 * GrowMo Delegated Spending Policy Engine
 * 
 * Evaluates purchase requests against global safety caps and user-configured
 * spending policy rules (daily budget limits, night restrictions, category blocks).
 */

const { isDBConnected, Order } = require('./db');

const GLOBAL_MAX_TRANSACTION_AMOUNT = 200000; // ₹2,000 in paise

/**
 * Evaluates whether a proposed item purchase is allowed for a user.
 * 
 * @param {Object} item - Product catalog item { id, name, price, category }
 * @param {Object} user - User object containing policy preferences
 * @returns {Promise<{ allowed: boolean, reason?: string, policyType?: string }>}
 */
async function evaluatePurchasePolicy(item, user = {}) {
  const dailyLimit = user.dailySpendingLimit || GLOBAL_MAX_TRANSACTION_AMOUNT;
  const disallowNight = user.disallowNightPurchases || false;
  const categoryRestrictions = user.categoryRestrictions || [];

  // 1. Global Hard Ceiling
  if (item.price > GLOBAL_MAX_TRANSACTION_AMOUNT) {
    return {
      allowed: false,
      policyType: 'global_ceiling',
      reason: `Transaction of ₹${item.price / 100} exceeds the hard spending ceiling of ₹${GLOBAL_MAX_TRANSACTION_AMOUNT / 100}`,
    };
  }

  // 2. Night-Time Purchase Restriction (00:00 - 06:00)
  if (disallowNight) {
    // Compute current hour in India Standard Time (Asia/Kolkata)
    const istHourString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false, hour: 'numeric' });
    const currentHour = parseInt(istHourString, 10);
    if (currentHour >= 0 && currentHour < 6) {
      return {
        allowed: false,
        policyType: 'night_restriction',
        reason: 'Policy Violation: Purchases are disallowed during night-time hours (00:00 - 06:00) IST',
      };
    }
  }

  // 3. Restricted Category Check
  if (item.category && categoryRestrictions.includes(item.category)) {
    return {
      allowed: false,
      policyType: 'category_restriction',
      reason: `Policy Violation: Category '${item.category}' is restricted by user policy`,
    };
  }

  // 4. Cumulative Daily Spending Limit Check
  if (user._id && isDBConnected()) {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const todaysOrders = await Order.find({
        userId: user._id.toString(),
        createdAt: { $gte: startOfDay },
        status: { $in: ['CREATED', 'PAID'] },
      });

      const spentToday = todaysOrders.reduce((sum, ord) => sum + ord.amount, 0);
      if (spentToday + item.price > dailyLimit) {
        return {
          allowed: false,
          policyType: 'daily_limit_exceeded',
          reason: `Policy Violation: Daily spending limit of ₹${dailyLimit / 100} would be exceeded. Spent today: ₹${spentToday / 100}`,
        };
      }
    } catch (err) {
      console.error('[Policy Engine DB Error]:', err.message);
    }
  }

  return { allowed: true };
}

module.exports = { evaluatePurchasePolicy, GLOBAL_MAX_TRANSACTION_AMOUNT };
