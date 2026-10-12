const express = require('express');
const dotenv = require('dotenv');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { GoogleGenAI } = require('@google/genai');
const rateLimit = require('express-rate-limit');
const { catalog, findCatalogItem } = require('./catalog');
const cors = require('cors');
const { logEvent, getLog } = require('./auditlog');
const { connectDB, isDBConnected, User, Order } = require('./db');
const { evaluatePurchasePolicy, GLOBAL_MAX_TRANSACTION_AMOUNT } = require('./policyEngine');

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET; // No fallback – must be set via env

// --- Startup Environment Validation ---
const requiredEnvVars = ['GEMINI_API_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`[CRITICAL] Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

app.set('trust proxy', 1);

// --- Auth Middleware ---
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (isDBConnected()) {
        const foundUser = await User.findById(decoded.userId).lean();
        if (foundUser) {
          req.user = foundUser;
          return next();
        }
      }
    } catch (e) {
      // Invalid or expired token – reject request
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }
  // No token – treat as guest (limited functionality)
  req.user = {
    _id: 'guest',
    username: 'guest',
    dailySpendingLimit: GLOBAL_MAX_TRANSACTION_AMOUNT,
    disallowNightPurchases: false,
    categoryRestrictions: [],
  };
  next();
}

// --- Rate Limiting Guardrails ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const interpretLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // Limit interpret calls to 30 per 15 minutes
  message: { error: 'Interpretation rate limit exceeded. Please wait a bit before trying again.' },
});

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
}));

// --- Razorpay Webhook Endpoint (MUST be before express.json()) ---
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    if (!signature) {
      return res.status(400).json({ error: 'x-razorpay-signature header missing' });
    }

    const rawBody = req.body;
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
    const signatureBuffer = Buffer.from(signature, 'utf-8');

    const isValid =
      expectedBuffer.length === signatureBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, signatureBuffer);

    if (!isValid) {
      logEvent({ type: 'webhook_invalid_signature', reason: 'HMAC mismatch' });
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const eventData = JSON.parse(rawBody.toString('utf-8'));
    const { event, payload } = eventData;

    console.log(`[Razorpay Webhook Received]: Event '${event}'`);

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = payload.payment ? payload.payment.entity : null;
      const orderId = paymentEntity ? paymentEntity.order_id : payload.order?.entity?.id;
      const paymentId = paymentEntity ? paymentEntity.id : null;

      if (orderId) {
        if (isDBConnected()) {
          const existingOrder = await Order.findOne({ orderId });
          if (existingOrder && existingOrder.status === 'PAID') {
            console.log(`[Razorpay Webhook]: Order ${orderId} is already PAID. Skipping (Idempotent).`);
            logEvent({ type: 'webhook_ignored_duplicate', orderId, paymentId });
            return res.status(200).json({ status: 'ok', message: 'Already processed (idempotent)' });
          }

          await Order.findOneAndUpdate(
            { orderId },
            { paymentId, status: 'PAID' }
          );
        }

        logEvent({
          type: 'webhook_payment_captured',
          orderId,
          paymentId,
          event,
        });
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = payload.payment ? payload.payment.entity : null;
      const orderId = paymentEntity ? paymentEntity.order_id : null;
      const paymentId = paymentEntity ? paymentEntity.id : null;

      if (orderId && isDBConnected()) {
        await Order.findOneAndUpdate({ orderId }, { paymentId, status: 'FAILED' });
      }

      logEvent({ type: 'webhook_payment_failed', orderId, paymentId, event });
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Error handling Razorpay webhook:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

app.use(express.json());

app.use('/api/', apiLimiter);
app.use('/api/interpret', interpretLimiter);
app.use(authMiddleware);

const PORT = process.env.PORT || 5000;

// --- Service instances ---

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Auth & Policy Routes ---

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, dailySpendingLimit, disallowNightPurchases } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    if (isDBConnected()) {
      const existing = await User.findOne({ username });
      if (existing) {
        return res.status(400).json({ error: 'Username already taken' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await User.create({
        username,
        passwordHash,
        dailySpendingLimit: dailySpendingLimit || 200000,
        disallowNightPurchases: !!disallowNightPurchases,
      });

      const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: { id: user._id, username: user.username, dailySpendingLimit: user.dailySpendingLimit, disallowNightPurchases: user.disallowNightPurchases } });
    }

    res.status(503).json({ error: 'Database disconnected' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    if (isDBConnected()) {
      const user = await User.findOne({ username });
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: { id: user._id, username: user.username, dailySpendingLimit: user.dailySpendingLimit, disallowNightPurchases: user.disallowNightPurchases } });
    }

    res.status(503).json({ error: 'Database disconnected' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user });
});

app.put('/api/auth/policy', async (req, res) => {
  try {
    const { dailySpendingLimit, disallowNightPurchases, categoryRestrictions } = req.body;
    if (req.user._id === 'guest' || !isDBConnected()) {
      return res.status(401).json({ error: 'Authenticated account required to modify policies' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        ...(dailySpendingLimit !== undefined && { dailySpendingLimit }),
        ...(disallowNightPurchases !== undefined && { disallowNightPurchases }),
        ...(categoryRestrictions !== undefined && { categoryRestrictions }),
      },
      { new: true }
    ).lean();

    res.json({ user: updatedUser });
  } catch (err) {
    console.error('Update policy error:', err);
    res.status(500).json({ error: 'Failed to update policy' });
  }
});

// --- Core Order & Payment Routes ---

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.post('/api/create-order', async (req, res) => {
  try {
    const { itemId } = req.body;

    if (!itemId) {
      return res.status(400).json({ error: 'itemId is required' });
    }

    const item = findCatalogItem(itemId);

    if (!item) {
      return res.status(404).json({ error: 'Item not found in catalog' });
    }

    // Evaluate Delegated Spending Policy Engine
    const policyResult = await evaluatePurchasePolicy(item, req.user);

    if (!policyResult.allowed) {
      if (isDBConnected()) {
        try {
          await Order.create({
            userId: req.user._id?.toString() || 'guest',
            itemId: item.id,
            amount: item.price,
            status: 'BLOCKED',
            reason: policyResult.reason,
          });
        } catch (dbErr) {
          console.error('[DB Error creating blocked order]:', dbErr.message);
        }
      }

      logEvent({
        type: 'order_blocked',
        userId: req.user._id?.toString() || 'guest',
        itemId: item.id,
        amount: item.price,
        reason: policyResult.reason,
      });
      return res.status(403).json({ error: policyResult.reason, policyType: policyResult.policyType });
    }

    const options = {
      amount: item.price,
      currency: 'INR',
      payment_capture: 1,
    };

    const order = await razorpay.orders.create(options);

    // Save order in MongoDB
    if (isDBConnected()) {
      try {
        await Order.create({
          userId: req.user._id?.toString() || 'guest',
          orderId: order.id,
          itemId: item.id,
          amount: item.price,
          currency: 'INR',
          status: 'CREATED',
        });
      } catch (dbErr) {
        console.error('[DB Error creating order]:', dbErr.message);
      }
    }

    logEvent({
      type: 'order_created',
      userId: req.user._id?.toString() || 'guest',
      itemId: item.id,
      amount: item.price,
      orderId: order.id,
    });

    res.json({ order, item });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are all required' });
    }

    const body = razorpay_order_id + '|' + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
    const signatureBuffer = Buffer.from(razorpay_signature, 'utf-8');

    // Length check before timingSafeEqual to prevent throws on length mismatch
    const isValid =
      expectedBuffer.length === signatureBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, signatureBuffer);

    // Update Order status in MongoDB
    if (isDBConnected()) {
      try {
        await Order.findOneAndUpdate(
          { orderId: razorpay_order_id },
          {
            paymentId: razorpay_payment_id,
            status: isValid ? 'PAID' : 'FAILED',
          }
        );
      } catch (dbErr) {
        console.error('[DB Error updating payment verification]:', dbErr.message);
      }
    }

    logEvent({
      type: 'payment_verification',
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      verified: isValid,
    });

    if (isValid) {
      res.json({ verified: true, message: 'Payment verified successfully' });
    } else {
      res.status(400).json({ verified: false, message: 'Signature mismatch — payment could not be verified' });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ error: 'Verification failed due to a server error' });
  }
});

app.post('/api/interpret', async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    // Security & Memory Limit: Cap client history to last 6 turns
    const MAX_HISTORY_TURNS = 6;
    const safeHistory = Array.isArray(conversationHistory)
      ? conversationHistory
          .slice(-MAX_HISTORY_TURNS)
          .filter((m) => m && m.role && m.text)
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.text).substring(0, 300)}`)
          .join('\n')
      : '';

    const catalogDescription = catalog
      .map((p) => `- id: "${p.id}", name: "${p.name}", price: ₹${p.price / 100}`)
      .join('\n');

    const decisionSchema = {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['purchase', 'list_catalog', 'order_status', 'refund_cancel', 'policy_inquiry', 'unclear'],
          description: '"purchase" to buy an item, "list_catalog" to see catalog, "order_status" to check past orders/purchases, "refund_cancel" to request refund/cancel order, "policy_inquiry" to ask about spending rules/limits, "unclear" otherwise.',
        },
        matched: {
          type: 'boolean',
          description: 'Only relevant when intent is "purchase". True if the request clearly matches exactly one catalog item.',
        },
        itemId: {
          type: 'string',
          description: 'Only relevant when intent is "purchase". The id of the matched catalog item, or empty string if no match.',
        },
        reasoning: {
          type: 'string',
          description: 'A short, human-readable explanation of the decision.',
        },
      },
      required: ['intent', 'matched', 'itemId', 'reasoning'],
    };

    const prompt = `You are an agentic shopping and account assistant for GrowMo. Here is the exact catalog of items available:

${catalogDescription}

${safeHistory ? `Recent Conversation Context:\n${safeHistory}\n` : ''}
Latest user request: "${message}"

Classify the user intent:
- "list_catalog": If asking to view or browse products.
- "order_status": If asking about past orders, purchases, or transaction history.
- "refund_cancel": If requesting a refund, cancellation, or return.
- "policy_inquiry": If asking about spending limits, budget rules, or constraints.
- "purchase": If asking to buy a specific item.
- "unclear": If none of the above.`;

    const interaction = await ai.interactions.create({
      model: 'gemini-3.8-flash',
      input: prompt,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: decisionSchema,
      },
    });

    const decision = JSON.parse(interaction.output_text);

    if (decision.intent === 'list_catalog') {
      logEvent({ type: 'interpretation', message, matched: false, intent: 'list_catalog' });
      return res.json({ matched: false, intent: 'list_catalog', catalog, reasoning: decision.reasoning });
    }

    if (decision.intent === 'policy_inquiry') {
      const userLimit = req.user.dailySpendingLimit ? `₹${req.user.dailySpendingLimit / 100}` : '₹2,000';
      const nightRule = req.user.disallowNightPurchases ? 'Night purchases (00:00 - 06:00) are restricted.' : 'Night purchases are allowed.';
      const policyMsg = `Your active spending policy: Daily limit is ${userLimit}. ${nightRule} Hard single-item ceiling is ₹2,000.`;

      logEvent({ type: 'interpretation', message, matched: false, intent: 'policy_inquiry' });
      return res.json({ matched: false, intent: 'policy_inquiry', reasoning: `${decision.reasoning} ${policyMsg}` });
    }

    if (decision.intent === 'order_status') {
      let ordersSummary = 'No recent orders found.';
      if (isDBConnected()) {
        const userOrders = await Order.find({ userId: req.user._id?.toString() || 'guest' })
          .sort({ createdAt: -1 })
          .limit(5)
          .lean();

        if (userOrders.length > 0) {
          ordersSummary = 'Your recent orders:\n' + userOrders.map((o) => `- Item: ${o.itemId} | Amount: ₹${o.amount / 100} | Status: ${o.status} | Date: ${new Date(o.createdAt).toLocaleDateString()}`).join('\n');
        }
      }
      logEvent({ type: 'interpretation', message, matched: false, intent: 'order_status' });
      return res.json({ matched: false, intent: 'order_status', reasoning: `${decision.reasoning}\n\n${ordersSummary}` });
    }

    if (decision.intent === 'refund_cancel') {
      let refundMsg = 'No eligible paid order found to refund.';
      if (isDBConnected()) {
        const eligibleOrder = await Order.findOne({
          userId: req.user._id?.toString() || 'guest',
          status: 'PAID',
        }).sort({ createdAt: -1 });

        if (eligibleOrder) {
          eligibleOrder.status = 'REFUNDED';
          await eligibleOrder.save();
          refundMsg = `Order ${eligibleOrder.orderId || eligibleOrder._id} for item '${eligibleOrder.itemId}' (₹${eligibleOrder.amount / 100}) has been marked as REFUNDED.`;
          logEvent({ type: 'order_refunded', orderId: eligibleOrder.orderId, itemId: eligibleOrder.itemId });
        }
      }
      logEvent({ type: 'interpretation', message, matched: false, intent: 'refund_cancel' });
      return res.json({ matched: false, intent: 'refund_cancel', reasoning: `${decision.reasoning}\n\n${refundMsg}` });
    }

    // Never trust the model's output blindly — re-verify against the real catalog
    const matchedItem = findCatalogItem(decision.itemId);

    logEvent({
      type: 'interpretation',
      message,
      matched: decision.matched && !!matchedItem,
      itemId: matchedItem ? matchedItem.id : null,
      reasoning: decision.reasoning,
    });

    if (!decision.matched || !matchedItem) {
      return res.json({
        matched: false,
        reasoning: decision.reasoning,
      });
    }

    res.json({
      matched: true,
      item: matchedItem,
      reasoning: decision.reasoning,
    });
  } catch (error) {
    console.error('Error interpreting request:', error);
    res.status(500).json({ error: 'Failed to interpret request' });
  }
});

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await connectDB();
});

app.get('/api/audit-log', async (req, res) => {
  const logs = await getLog();
  res.json(logs);
});