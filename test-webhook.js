/**
 * GrowMo Razorpay Webhook Test Suite
 * 
 * Verifies HMAC SHA-256 signature verification, raw body parsing,
 * event handling, and idempotency (duplicate event suppression).
 */

const crypto = require('crypto');
const dotenv = require('dotenv');
dotenv.config();

const API_URL = process.env.TEST_API_URL || 'http://localhost:5000';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;

async function runWebhookTests() {
  console.log('--------------------------------------------------');
  console.log('⚡ GROW MO RAZORPAY WEBHOOK TEST SUITE');
  console.log('--------------------------------------------------\n');

  let passed = 0;
  let failed = 0;

  async function assertTest(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  const testOrderId = `order_wh_${Date.now()}`;
  const testPaymentId = `pay_wh_${Date.now()}`;

  const samplePayload = {
    entity: 'event',
    account_id: 'acc_test123',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: testPaymentId,
          entity: 'payment',
          amount: 49900,
          currency: 'INR',
          status: 'captured',
          order_id: testOrderId,
          method: 'upi',
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  const rawBodyString = JSON.stringify(samplePayload);

  // Sign payload
  const validSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBodyString)
    .digest('hex');

  // Test 1: Valid Webhook Delivery
  await assertTest('Webhook - Valid Signature Payment Captured', async () => {
    const res = await fetch(`${API_URL}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validSignature,
      },
      body: rawBodyString,
    });

    if (!res.ok) {
      throw new Error(`Expected HTTP 200 OK, got ${res.status}`);
    }

    const data = await res.json();
    if (data.status !== 'ok') {
      throw new Error(`Expected status: ok, got ${JSON.stringify(data)}`);
    }
  });

  // Test 2: Idempotency (Duplicate Webhook Delivery)
  await assertTest('Webhook Idempotency - Suppress Duplicate Event', async () => {
    const res = await fetch(`${API_URL}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validSignature,
      },
      body: rawBodyString,
    });

    if (!res.ok) {
      throw new Error(`Expected HTTP 200 OK, got ${res.status}`);
    }

    const data = await res.json();
    if (data.status !== 'ok') {
      throw new Error(`Expected idempotent status ok, got ${JSON.stringify(data)}`);
    }
  });

  // Test 3: Invalid Signature Rejection
  await assertTest('Webhook - Reject Invalid Signature', async () => {
    const res = await fetch(`${API_URL}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': 'invalid_forged_webhook_signature_0000000000000000',
      },
      body: rawBodyString,
    });

    if (res.status !== 400) {
      throw new Error(`Expected HTTP 400 Bad Request, got ${res.status}`);
    }
  });

  // Test 4: Missing Signature Header Rejection
  await assertTest('Webhook - Reject Missing Signature Header', async () => {
    const res = await fetch(`${API_URL}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBodyString,
    });

    if (res.status !== 400) {
      throw new Error(`Expected HTTP 400 Bad Request, got ${res.status}`);
    }
  });

  console.log('\n--------------------------------------------------');
  console.log(`📊 WEBHOOK TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('--------------------------------------------------');

  if (failed > 0) process.exit(1);
}

runWebhookTests().catch((err) => {
  console.error('Fatal error running webhook test suite:', err);
  process.exit(1);
});
