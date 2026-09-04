const crypto = require('crypto');
const dotenv = require('dotenv');
dotenv.config();

const order_id = 'order_test123';
const payment_id = 'pay_test456';

const body = order_id + '|' + payment_id;

const signature = crypto
  .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
  .update(body)
  .digest('hex');

console.log('order_id:', order_id);
console.log('payment_id:', payment_id);
console.log('signature:', signature);