const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/growmo';

function isDBConnected() {
  return mongoose.connection.readyState === 1;
}

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 3000,
    });
    console.log(`[MongoDB] Connected successfully to ${MONGODB_URI}`);
  } catch (error) {
    console.warn(`[MongoDB Warning] Could not connect to database at ${MONGODB_URI}: ${error.message}`);
    console.warn(`[MongoDB Warning] System will continue running using file-based storage fallback.`);
  }
}

// User Schema
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String, default: null },
    verificationTokenExpiry: { type: Date, default: null },
    dailySpendingLimit: { type: Number, default: 200000 }, // ₹2000 in paise
    disallowNightPurchases: { type: Boolean, default: false }, // Disallow between 00:00 and 06:00
    categoryRestrictions: [{ type: String }],
  },
  { timestamps: true }
);

// Order Schema
const orderSchema = new mongoose.Schema(
  {
    userId: { type: String, default: 'guest', index: true },
    orderId: { type: String, unique: true, sparse: true },
    itemId: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    paymentId: { type: String, default: null },
    status: {
      type: String,
      enum: ['CREATED', 'PAID', 'FAILED', 'BLOCKED', 'CANCELLED', 'REFUNDED'],
      default: 'CREATED',
    },
    reason: { type: String, default: null },
  },
  { timestamps: true }
);

// AuditLog Schema
const auditLogSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now },
    userId: { type: String, default: 'guest' },
    type: { type: String, required: true },
    message: String,
    itemId: String,
    orderId: String,
    paymentId: String,
    verified: Boolean,
    matched: Boolean,
    intent: String,
    reasoning: String,
    amount: Number,
    reason: String,
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);

module.exports = { connectDB, isDBConnected, User, Order, AuditLog };
