/**
 * /api/validate-licence
 *
 * Called by app.js on every page load to confirm a localStorage licence is genuine.
 *
 * Inputs (POST body, JSON):
 *   { payload: { v, tier, plan, issued_at, expires, session_id }, signature: 'hex...' }
 *
 * Behaviour:
 *   1. Re-compute HMAC-SHA256 over the payload using LICENCE_SIGNING_SECRET
 *   2. Constant-time compare to the supplied signature
 *   3. Check the payload's expiry has not passed
 *   4. Return { valid: true, tier, plan, expires } or { valid: false, reason }
 *
 * Forged localStorage entries (where a user has set their own tier/expiry without a
 * genuine signature) will fail step 2 and be rejected. The client deletes the entry
 * and stays locked.
 *
 * Environment variables required:
 *   - LICENCE_SIGNING_SECRET  (same value as used by /api/issue-licence)
 */

const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!process.env.LICENCE_SIGNING_SECRET) {
    console.error('[validate-licence] LICENCE_SIGNING_SECRET env var is missing');
    return res.status(500).json({ valid: false, reason: 'server_misconfigured' });
  }

  const { payload, signature } = req.body || {};

  // Shape check — reject anything that doesn't look like our payload
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof signature !== 'string' ||
    payload.v !== 1 ||
    typeof payload.tier !== 'string' ||
    typeof payload.plan !== 'string' ||
    typeof payload.issued_at !== 'number' ||
    typeof payload.expires !== 'number' ||
    typeof payload.session_id !== 'string'
  ) {
    return res.status(400).json({ valid: false, reason: 'malformed_licence' });
  }

  // Recompute the expected signature over the canonical JSON serialisation.
  // The client must send the payload exactly as it was issued — same key order, same
  // types — so JSON.stringify on the same object shape produces the same bytes.
  // (Node and browsers both serialise property order as insertion order for plain
  // objects, and the keys above are fixed.)
  const payloadJson = JSON.stringify({
    v:          payload.v,
    tier:       payload.tier,
    plan:       payload.plan,
    issued_at:  payload.issued_at,
    expires:    payload.expires,
    session_id: payload.session_id,
  });
  const expected = crypto
    .createHmac('sha256', process.env.LICENCE_SIGNING_SECRET)
    .update(payloadJson)
    .digest('hex');

  // Constant-time comparison — never use === for crypto signatures
  let sigsMatch = false;
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    sigsMatch = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    sigsMatch = false;
  }

  if (!sigsMatch) {
    return res.status(401).json({ valid: false, reason: 'invalid_signature' });
  }

  // Signature OK — now check expiry
  if (payload.expires <= Date.now()) {
    return res.status(200).json({ valid: false, reason: 'expired' });
  }

  // All good
  return res.status(200).json({
    valid: true,
    tier: payload.tier,
    plan: payload.plan,
    expires: payload.expires,
  });
};
