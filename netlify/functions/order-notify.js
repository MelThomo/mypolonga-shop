const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    return { statusCode: 400, body: 'Missing session_id' };
  }

  try {
    // Fetch the completed Stripe session with line items
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items', 'line_items.data.price.product'],
    });

    // Extract order details
    const customerName    = session.customer_details?.name || session.metadata?.customer_name || 'Customer';
    const customerEmail   = session.customer_details?.email || '';
    const customerPhone   = session.customer_details?.phone || '';
    const shippingAddress = session.shipping_details?.address;
    const total           = (session.amount_total / 100).toFixed(2);
    const orderId         = session.id.slice(-8).toUpperCase();

    const addressLines = shippingAddress ? [
      shippingAddress.line1,
      shippingAddress.line2,
      shippingAddress.city,
      shippingAddress.state,
      shippingAddress.postal_code,
      shippingAddress.country,
    ].filter(Boolean).join(', ') : 'Not provided';

    // Build items table rows
    const itemRows = (session.line_items?.data || []).map(item => {
      const qty   = item.quantity;
      const name  = item.description || item.price?.product?.name || 'Item';
      const price = ((item.amount_total) / 100).toFixed(2);
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${qty}x ${name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">A$${price}</td>
      </tr>`;
    }).join('');

    // ── INTERNAL NOTIFICATION EMAIL (to Mel + Mypolonga) ──────────────────────
    const internalHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#9BBF1B;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">New Order — Mypolonga Orchard</h1>
      <p style="color:#f0f7d4;margin:4px 0 0;font-size:14px;">Order #${orderId}</p>
    </div>
    <div style="padding:32px;">
      <h2 style="color:#2C2A26;font-size:16px;margin:0 0 16px;">Customer Details</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <tr><td style="padding:6px 0;color:#888;width:140px;">Name</td><td style="padding:6px 0;font-weight:600;">${customerName}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Email</td><td style="padding:6px 0;">${customerEmail}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Phone</td><td style="padding:6px 0;">${customerPhone || 'Not provided'}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Ship to</td><td style="padding:6px 0;">${addressLines}</td></tr>
      </table>

      <h2 style="color:#2C2A26;font-size:16px;margin:0 0 12px;">Order Items</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <thead>
          <tr style="background:#f7f4ef;">
            <th style="padding:8px 12px;text-align:left;color:#555;">Item</th>
            <th style="padding:8px 12px;text-align:right;color:#555;">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr>
            <td style="padding:12px;font-weight:700;font-size:16px;">ORDER TOTAL</td>
            <td style="padding:12px;font-weight:700;font-size:16px;text-align:right;color:#9BBF1B;">A$${total}</td>
          </tr>
        </tfoot>
      </table>

      <div style="background:#f0f7d4;border-radius:8px;padding:16px;font-size:13px;color:#4a5e10;">
        <strong>Action required:</strong> Pack and dispatch this order via Aus Post. Reply to the customer at <a href="mailto:${customerEmail}">${customerEmail}</a> with tracking once shipped.
      </div>
    </div>
  </div>
</body>
</html>`;

    // ── CUSTOMER CONFIRMATION EMAIL ────────────────────────────────────────────
    const customerHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#9BBF1B;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;">Thank you for your order!</h1>
      <p style="color:#f0f7d4;margin:4px 0 0;font-size:14px;">Mypolonga Orchard — Thomson Family, South Australia</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#2C2A26;font-size:16px;">Hi ${customerName},</p>
      <p style="color:#555;font-size:15px;line-height:1.6;">We've received your order and the Thomson Family will get it packed and on its way to you soon. You'll receive a shipping confirmation with your tracking number once it's dispatched.</p>

      <h2 style="color:#2C2A26;font-size:16px;margin:24px 0 12px;">Your Order Summary</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <thead>
          <tr style="background:#f7f4ef;">
            <th style="padding:8px 12px;text-align:left;color:#555;">Item</th>
            <th style="padding:8px 12px;text-align:right;color:#555;">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr>
            <td style="padding:12px;font-weight:700;font-size:16px;">Total Paid</td>
            <td style="padding:12px;font-weight:700;font-size:16px;text-align:right;color:#9BBF1B;">A$${total}</td>
          </tr>
        </tfoot>
      </table>

      <p style="color:#555;font-size:14px;">Shipping to: <strong>${addressLines}</strong></p>

      <div style="background:#f0f7d4;border-radius:8px;padding:16px;font-size:14px;color:#4a5e10;margin:24px 0;">
        Questions about your order? Email us at <a href="mailto:mypolongaorchard@gmail.com" style="color:#9BBF1B;">mypolongaorchard@gmail.com</a>
      </div>

      <p style="color:#888;font-size:13px;">Mypolonga Orchard | Thomson Family | Mypolonga, South Australia | Since 1985</p>
    </div>
  </div>
</body>
</html>`;

    const RESEND_KEY = process.env.RESEND_API_KEY;
    const FROM_EMAIL = 'orders@mypolongaorchard.com.au';

    const sendEmail = async (to, subject, html) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
      });
      return res.json();
    };

    // Send internal notifications to both addresses
    await Promise.all([
      sendEmail(
        ['mel@funnelcreators.com', 'mypolongaorchard@gmail.com'],
        `New Order #${orderId} — ${customerName} — A$${total}`,
        internalHtml
      ),
      // Send customer confirmation if we have their email
      customerEmail ? sendEmail(
        [customerEmail],
        `Your Mypolonga Orchard order is confirmed — #${orderId}`,
        customerHtml
      ) : Promise.resolve(),
    ]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, order_id: orderId }),
    };

  } catch (err) {
    console.error('Order notify error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
