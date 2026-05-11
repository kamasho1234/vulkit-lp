# Stripe Checkout setup

## Required Vercel environment variable

- `STRIPE_SECRET_KEY`: Stripe secret key. Use `sk_test_...` for testing and `sk_live_...` for production.

## Optional Vercel environment variables

- `PUBLIC_SITE_URL`: `https://vulkit.kamacrafy.com`
- `STRIPE_SUCCESS_URL`: Custom success URL. Default is `https://vulkit.kamacrafy.com/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`.
- `STRIPE_CANCEL_URL`: Custom cancel URL. Default is `https://vulkit.kamacrafy.com/checkout-cancel.html`.
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret for `/api/stripe-webhook`.

## Checkout products configured in code

- `single`: VULKIT VBP101 1 item, `29,800 JPY`
- `double`: VULKIT VBP101 2 items, `54,600 JPY`
- Shipping: free shipping
- Shipping address collection: Japan
- Payment methods: Stripe automatic payment methods

## Live setup checklist

1. Add `STRIPE_SECRET_KEY` to Vercel Production and Preview.
2. In Stripe Dashboard, enable the payment methods you want to accept.
3. Add a Stripe webhook endpoint: `https://vulkit.kamacrafy.com/api/stripe-webhook`.
4. Select these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`.
5. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`.
6. Test with `sk_test_...` first.
7. Switch Vercel Production to `sk_live_...` only when ready to receive real payments.
8. Redeploy Vercel after changing environment variables.
