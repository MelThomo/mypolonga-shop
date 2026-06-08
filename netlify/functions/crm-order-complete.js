const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CRM_ORDERS_URL = 'https://mypo-orchard-crm.manus.space/api/webhooks/orders';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { session_id } = body;
  if (!session_id) {
    return { statusCode: 400, body: 'session_id required' };
  }

  try {
    // Fetch the completed Stripe session with line items and discount details
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items', 'total_details.breakdown'],
    });

    if (session.payment_status !== 'paid') {
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: 'not paid' }) };
    }

    // Build cart array from Stripe line items (excluding shipping)
    const cartItems = (session.line_items?.data || [])
      .filter(item => item.description !== 'Australia Post Shipping & Handling' &&
                      item.price?.product_data?.name !== 'Australia Post Shipping & Handling')
      .map(item => ({
        product_name: item.description || item.price?.product_data?.name || 'Product',
        quantity:     item.quantity,
        line_total:   parseFloat((item.amount_total / 100).toFixed(2)),
      }));

    // Find shipping line item
    const shippingItem = (session.line_items?.data || [])
      .find(item => item.description === 'Australia Post Shipping & Handling' ||
                    item.price?.product_data?.name === 'Australia Post Shipping & Handling');
    const shippingTotal = shippingItem ? parseFloat((shippingItem.amount_total / 100).toFixed(2)) : 0;

    // Extract discount info — prefer metadata (set at checkout creation) as the reliable source
    const discountAmount = parseFloat(((session.total_details?.amount_discount || 0) / 100).toFixed(2));
    const promoCodeFromMeta = session.metadata?.promo_code || null;
    const discountFromMeta  = session.metadata?.discount_amount ? parseFloat(session.metadata.discount_amount) : discountAmount;

    const subtotal = parseFloat(((session.amount_total / 100) + discountAmount - shippingTotal).toFixed(2));
    const total    = parseFloat((session.amount_total / 100).toFixed(2));

    const crmPayload = {
      customer_name:  session.metadata?.customer_name || session.customer_details?.name || '',
      customer_email: session.customer_email || session.customer_details?.email || '',
      customer_phone: session.customer_details?.phone || '',
      cart:           cartItems,
      order_summary: {
        subtotal:     subtotal,
        discount:     discountFromMeta,
        promo_code:   promoCodeFromMeta || null,
        shipping:     shippingTotal,
        total:        total,
      },
    };

    const res = await fetch(CRM_ORDERS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(crmPayload),
    });

    const result = await res.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, crm: result }),
    };
  } catch (err) {
    console.error('CRM order complete error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
