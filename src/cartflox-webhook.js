const crypto = require('crypto');

const MAX_AGE_SECONDS = 300; // 5 minutes, recommandation officielle Cartflox.

// Vérifie le header `X-Afriflow-Signature: t=<timestamp>,v1=<hex>` d'un webhook
// Cartflox. Doit recevoir le corps BRUT (string), pas du JSON déjà parsé —
// sinon le HMAC ne correspondra jamais (ordre des clés, espaces, etc).
function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(',');
  const timestamp = parts.find((p) => p.startsWith('t='))?.split('=')[1];
  const hash = parts.find((p) => p.startsWith('v1='))?.split('=')[1];
  if (!timestamp || !hash) return false;

  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (age > MAX_AGE_SECONDS) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

  const expectedBuf = Buffer.from(expected);
  const hashBuf = Buffer.from(hash);
  if (expectedBuf.length !== hashBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, hashBuf);
}

module.exports = { verifySignature };
