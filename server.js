const express = require('express');
const dotenv = require('dotenv');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');
const { catalog, findCatalogItem } = require('./catalog');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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

    const options = {
      amount: item.price,
      currency: 'INR',
      payment_capture: 1,
    };

    const order = await razorpay.orders.create(options);

    res.json({ order, item });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.post('/api/verify-payment', (req, res) => {
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

    const isValid = expectedSignature === razorpay_signature;

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
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const catalogDescription = catalog
      .map((p) => `- id: "${p.id}", name: "${p.name}", price: ₹${p.price / 100}`)
      .join('\n');

    const decisionSchema = {
      type: 'object',
      properties: {
        matched: {
          type: 'boolean',
          description: 'True if the user request clearly matches exactly one catalog item.',
        },
        itemId: {
          type: 'string',
          description: 'The id of the matched catalog item, or empty string if no match.',
        },
        reasoning: {
          type: 'string',
          description: 'A short, human-readable explanation of why this item was chosen (or why nothing matched).',
        },
      },
      required: ['matched', 'itemId', 'reasoning'],
    };

    const prompt = `You are a shopping assistant for GrowMo. Here is the exact catalog of items available. You must ONLY match against these — never invent an item that isn't listed.

${catalogDescription}

User request: "${message}"

Decide which catalog item (if any) this request matches, and explain your reasoning in one or two sentences.`;

    const interaction = await ai.interactions.create({
      model: 'gemini-3.7-flash',
      input: prompt,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: decisionSchema,
      },
    });

    const decision = JSON.parse(interaction.output_text);

    // Never trust the model's output blindly — re-verify against the real catalog
    const matchedItem = findCatalogItem(decision.itemId);

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

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});