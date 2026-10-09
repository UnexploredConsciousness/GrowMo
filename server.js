const express = require('express');
const dotenv = require('dotenv');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');
const rateLimit = require('express-rate-limit');
const { catalog, findCatalogItem } = require('./catalog');
const cors = require('cors');
const { logEvent, getLog } = require('./auditlog');
const { connectDB, isDBConnected, Order } = require('./db');

dotenv.config();

// --- Startup Environment Validation ---
const requiredEnvVars = ['GEMINI_API_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`[CRITICAL] Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const MAX_TRANSACTION_AMOUNT = 200000; // ₹2000 in paise — hard ceiling, no order above this is ever created

const app = express();

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

// --- Razorpay Webhook Endpoint (MUST be before express.json() to parse raw body for HMAC signature verification) ---
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
          // Idempotency check: check if order is already marked as PAID
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

const PORT = process.env.PORT || 5000;

// --- Service instances, grouped together for easy scanning ---

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Routes ---

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

    if (item.price > MAX_TRANSACTION_AMOUNT) {
      // Record blocked order attempt in DB & Audit Log
      if (isDBConnected()) {
        try {
          await Order.create({
            itemId: item.id,
            amount: item.price,
            status: 'BLOCKED',
            reason: 'Exceeds maximum allowed transaction amount',
          });
        } catch (dbErr) {
          console.error('[DB Error creating blocked order]:', dbErr.message);
        }
      }

      logEvent({
        type: 'order_blocked',
        itemId: item.id,
        amount: item.price,
        reason: 'Exceeds maximum allowed transaction amount',
      });
      return res.status(403).json({ error: 'This transaction exceeds the allowed spending limit' });
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
          enum: ['purchase', 'list_catalog', 'unclear'],
          description: '"purchase" if the user wants to buy a specific item, "list_catalog" if they want to see available items, "unclear" otherwise.',
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

    const prompt = `You are a shopping assistant for GrowMo. Here is the exact catalog of items available. You must ONLY match against these — never invent an item that isn't listed.

${catalogDescription}

${safeHistory ? `Recent Conversation Context:\n${safeHistory}\n` : ''}
Latest user request: "${message}"

If the user is asking to see, browse, or list available items rather than requesting a specific purchase, set intent to "list_catalog". Otherwise, decide which catalog item (if any) matches their request considering previous context, and explain your reasoning in one or two sentences.`;

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
      logEvent({
        type: 'interpretation',
        message,
        matched: false,
        intent: 'list_catalog',
      });

      return res.json({
        matched: false,
        intent: 'list_catalog',
        catalog,
        reasoning: decision.reasoning,
      });
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