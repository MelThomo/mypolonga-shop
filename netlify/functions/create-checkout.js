const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { cart, order_summary, customer_name, customer_email } = body;

  if (!cart || cart.length === 0) {
    return { statusCode: 400, body: 'Cart is empty' };
  }

  try {
    // Build line items from cart
    const lineItems = cart.map(item => ({
      price_data: {
        currency: 'aud',
        product_data: {
          name: item.name,
          description: item.tagline || '',
        },
        unit_amount: Math.round(item.price * 100), // Stripe uses cents
      },
      quantity: item.qty,
    }));

    // Add shipping as a separate line item
    const shippingAmount = Math.round((order_summary.shipping || 0) * 100);
    if (shippingAmount > 0) {
      lineItems.push({
        price_data: {
          currency: 'aud',
          product_data: {
            name: 'Shipping & Handling',
            description: order_summary.shipping_note || 'Aus Post postage + handling',
          },
          unit_amount: shippingAmount,
        },
        quantity: 1,
      });
    }

    // Apply discount if present
    let discounts = [];
    if (order_summary.discount && order_summary.discount > 0) {
      // Create a one-time coupon for this session
      const coupon = await stripe.coupons.create({
        amount_off: Math.round(order_summary.discount * 100),
        currency: 'aud',
        duration: 'once',
      });
      discounts = [{ coupon: coupon.id }];
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer_email: customer_email || undefined,
      discounts: discounts.length > 0 ? discounts : undefined,
      success_url: `${process.env.SITE_URL || 'https://shop.mypolongaorchard.com.au'}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL || 'https://shop.mypolongaorchard.com.au'}/`,
      metadata: {
        customer_name: customer_name || '',
        customer_email: customer_email || '',
        order_items: JSON.stringify(cart.map(i => `${i.qty}x ${i.name}`)),
      },
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['AU'],
      },
      phone_number_collection: { enabled: true },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
