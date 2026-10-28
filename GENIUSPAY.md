# GeniusPay integration guide

This repository stack (node) has no automated integration yet. Follow the steps below; the reviewed code snippets for your selected surfaces are embedded at the end.

## Confirmed payment workflow

1. Le client déclenche le paiement dans votre application ; l'encaissement a lieu avant la livraison ou la prestation (prépayé).
2. Votre serveur node appelle POST /v2/payments/initiate (clé pk_* côté serveur uniquement, idempotency_key unique par tentative, fee_bearer "merchant" — les frais sont à votre charge).
3. Le client est redirigé vers le checkout hébergé GeniusPay (checkout_url, valide 15 min), y choisit son moyen de paiement (wave, orange_money), puis revient sur votre URL de succès (success_url).
4. GeniusPay notifie le endpoint webhook créé pour vous (transaction.completed / failed) — après vérification de la signature HMAC et déduplication, votre serveur déclenche la livraison / l'activation.

## 1. Configure the environment

- `GENIUSPAY_API_KEY`
- `GENIUSPAY_BASE_URL`

Never commit real keys — use environment variables.

## 2. Payment flow

- Initiate payments with `POST {GENIUSPAY_BASE_URL}/v2/payments/initiate` (header `X-API-Key: pk_*`, unique `idempotency_key` per attempt).
- Hosted checkout: omit provider/operator and redirect the customer to the `checkout_url` in the response.
- Status: poll `GET {GENIUSPAY_BASE_URL}/v2/payments/{reference}`.

## 3. Webhooks

- Verify `X-GeniusPay-Signature` (HMAC-SHA256 over the **raw** body with your `whsec_*` secret) BEFORE parsing; compare in constant time.
- Deduplicate on `X-GeniusPay-Delivery` — deliveries retry with backoff.
- Acknowledge with 2xx fast, then process asynchronously.

## Notes

Unsupported stack (node): plan limited to an integration guide. [llm_LLM_RATE_LIMITED_429]

## Reviewed snippet — checkout_initiate

```js
// routes/geniuspay-checkout.js — create a hosted checkout (Express)
// Env: GENIUSPAY_API_KEY=pk_sandbox_..., GENIUSPAY_API_URL=https://api.geniuspay.ci

import express from 'express';

export const geniuspayCheckout = express.Router();
geniuspayCheckout.post('/checkout', express.json(), async (req, res) => {
  const { orderId, amount, currency, countryCode } = req.body;

  const r = await fetch(`${process.env.GENIUSPAY_API_URL}/v2/payments/initiate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GENIUSPAY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reference: String(orderId),
      amount,
      currency,
      country_code: countryCode,
      idempotency_key: crypto.randomUUID(),
      // no provider → hosted checkout
      success_url: `${req.protocol}://${req.get('host')}/payment/success`,
      cancel_url: `${req.protocol}://${req.get('host')}/payment/cancel`,
    }),
  });

  const body = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(r.status).json({ error: body?.error?.message ?? 'payment failed' });
  res.json({ checkout_url: body.checkout_url });
});

```

## Reviewed snippet — webhook_verify

```js
// routes/geniuspay-webhook.js — GeniusPay inbound webhook (Express)
// Env: GENIUSPAY_WEBHOOK_SECRET=whsec_...
// IMPORTANT: mount with express.raw({type:'application/json'}) — the signature
// covers the raw body, not the parsed JSON.

import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifySignature(rawBody, signatureHeader, timestampHeader, secret, toleranceSeconds = 300) {
    if (!signatureHeader || !timestampHeader || !secret)
        return false;
    const parts = new Map(signatureHeader.split(',').map((kv) => {
        const idx = kv.indexOf('=');
        return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    }));
    const t = parts.get('t');
    const v1 = parts.get('v1');
    if (!t || !v1 || t !== timestampHeader)
        return false;
    const ts = Number(t);
    if (!Number.isFinite(ts))
        return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSeconds)
        return false;
    const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(v1, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
}

const seen = new Set(); // naive dedup — use Redis/DB in production

export const geniuspayWebhook = express.Router();
geniuspayWebhook.post('/', express.raw({ type: 'application/json' }), (req, res) => {
  const ok = verifySignature(
    req.body, // Buffer thanks to express.raw
    req.get('x-geniuspay-signature'),
    req.get('x-geniuspay-timestamp'),
    process.env.GENIUSPAY_WEBHOOK_SECRET ?? '',
  );
  if (!ok) return res.status(401).send('invalid signature');

  const deliveryId = req.get('x-geniuspay-delivery') ?? '';
  if (seen.has(deliveryId)) return res.status(200).send('duplicate');
  seen.add(deliveryId);

  const event = JSON.parse(req.body.toString('utf8'));
  // TODO: dispatch event.event_type → transaction.completed/failed/cancelled/expired
  res.status(200).send('ok');
});

```

## Reviewed snippet — status_lookup

```js
// lib/geniuspay-status.ts — reconciliation status check
// Server-side only (uses the API key). For public success/cancel pages use
// GET /v2/public/status/{reference} — no auth, returns status + branding.

export async function getPaymentStatus(reference: string) {
  const res = await fetch(
    `${process.env.GENIUSPAY_API_URL}/v2/payments/${encodeURIComponent(reference)}/status`,
    { headers: { Authorization: `Bearer ${process.env.GENIUSPAY_API_KEY}` } },
  );
  if (!res.ok) throw new Error(`status check failed: ${res.status}`);
  return res.json() as Promise<{ status: string; label: string }>;
}

```
