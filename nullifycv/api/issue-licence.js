/**
 * /api/issue-licence
 *
 * Called by /success.html after a Stripe Checkout completes.
 *
 * Inputs (POST body, JSON):
 *   { session_id: 'cs_live_xxx', plan: 'week' }
 *
 * Behaviour:
 *   1. Verify the Stripe Checkout Session with Stripe's API
 *   2. Confirm payment_status === 'paid' (or 'no_payment_required' for $0 sessions)
 *   3. Build the licence payload (tier, plan, expiry, issued_at, session_id)
 *   4. Sign the payload with HMAC-SHA256 using LICENCE_SIGNING_SECRET
 *   5. Return { payload, signature } to the client
 *
 * The client stores both in localStorage. On every page load, the client calls
 * /api/validate-licence to confirm the signature is genuine. A forged localStorage
 * entry will fail signature validation and be rejected.
 *
 * Environment variables required:
 *   - STRIPE_SECRET_KEY       (sk_live_... or sk_test_...)
 *   - LICENCE_SIGNING_SECRET  (any random string, 32+ characters)
 */

const crypto = require('crypto');

const PLAN_CONFIG = {
  week:  { tier: 'seeker', days: 7   },
  pro:   { tier: 'pro',    days: 30  },
  proyr: { tier: 'pro',    days: 365 },
  team:  { tier: 'team',   days: 30  },
};

module.exports = async (req, res) => {
  // CORS / method guard
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Env-var presence check — fail loudly so misconfiguration is obvious
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[issue-licence] STRIPE_SECRET_KEY env var is missing');
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  if (!process.env.LICENCE_SIGNING_SECRET) {
    console.error('[issue-licence] LICENCE_SIGNING_SECRET env var is missing');
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  if (process.env.LICENCE_SIGNING_SECRET.length < 32) {
    console.error('[issue-licence] LICENCE_SIGNING_SECRET is too short (need 32+ chars)');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  // Parse body (Vercel parses JSON automatically when Content-Type is application/json)
  const { session_id, plan } = req.body || {};

  if (typeof session_id !== 'string' || !session_id.startsWith('cs_')) {
    return res.status(400).json({ error: 'invalid_session_id' });
  }
  if (typeof plan !== 'string' || !PLAN_CONFIG[plan]) {
    return res.status(400).json({ error: 'invalid_plan' });
  }

  // Verify the session with Stripe — direct HTTPS call, no SDK dependency
  let session;
  try {
    const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`, {
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(process.env.STRIPE_SECRET_KEY + ':').toString('base64'),
      },
    });
    if (!stripeRes.ok) {
      const errText = await stripeRes.text();
      console.error('[issue-licence] Stripe API error:', stripeRes.status, errText);
      return res.status(400).json({ error: 'stripe_session_lookup_failed' });
    }
    session = await stripeRes.json();
  } catch (err) {
    console.error('[issue-licence] Stripe API fetch failed:', err);
    return res.status(502).json({ error: 'stripe_unreachable' });
  }

  // Confirm the session was actually paid
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    console.warn('[issue-licence] Session not paid:', session_id, session.payment_status);
    return res.status(402).json({ error: 'session_not_paid', payment_status: session.payment_status });
  }

  // Build the licence payload
  const cfg = PLAN_CONFIG[plan];
  const issuedAt = Date.now();
  const expiry = issuedAt + cfg.days * 24 * 60 * 60 * 1000;

  const payload = {
    v: 1,                  // version, for future migration
    tier: cfg.tier,
    plan: plan,
    issued_at: issuedAt,
    expires: expiry,
    session_id: session_id,
  };

  // Sign with HMAC-SHA256. We sign the canonical JSON serialisation of the payload.
  const payloadJson = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', process.env.LICENCE_SIGNING_SECRET)
    .update(payloadJson)
    .digest('hex');

  return res.status(200).json({ payload, signature });
};
