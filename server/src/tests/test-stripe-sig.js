const crypto = require('crypto');

const secret = 'whsec_test123'; // pretend webhook secret
const payload = JSON.stringify({ hello: 'world' });
const timestamp = Math.floor(Date.now() / 1000);

const signedPayload = `${timestamp}.${payload}`;
const signature = crypto
  .createHmac('sha256', secret)
  .update(signedPayload)
  .digest('hex');

console.log('Payload:', payload);
console.log('Stripe-Signature header value:', `t=${timestamp},v1=${signature}`);
console.log('Secret to paste into UI:', secret);