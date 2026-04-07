"use strict";

const { Resend } = require("resend");

const FROM_ADDRESS = "Meckata Cacicka <booking@meckatacacicka.cz>";

let resendClient;

function getClient() {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

// ---------------------------------------------------------------------------
// Owner notification: new booking received with action buttons
// ---------------------------------------------------------------------------
async function sendBookingNotification(ownerEmail, booking, actionLinks) {
  const { date, time_slot, name, email, phone } = booking;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Georgia, serif; background: #faf6f1; padding: 24px; color: #3e2c1c;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e0d5c7;">
    <h2 style="color: #6b4226; margin-top: 0;">New Booking Request</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 100px;">Name</td><td style="padding: 8px 0; font-weight: bold;">${esc(name)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Email</td><td style="padding: 8px 0;">${esc(email)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Phone</td><td style="padding: 8px 0;">${esc(phone)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Date</td><td style="padding: 8px 0; font-weight: bold;">${esc(date)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Time</td><td style="padding: 8px 0; font-weight: bold;">${esc(time_slot)}</td></tr>
    </table>
    <div style="text-align: center;">
      <a href="${esc(actionLinks.accept)}" style="display: inline-block; padding: 12px 28px; background: #5a8f5c; color: #fff; text-decoration: none; border-radius: 8px; margin: 6px; font-weight: bold;">ACCEPT</a>
      <a href="${esc(actionLinks.reschedule)}" style="display: inline-block; padding: 12px 28px; background: #c4923a; color: #fff; text-decoration: none; border-radius: 8px; margin: 6px; font-weight: bold;">SUGGEST NEW TIME</a>
      <a href="${esc(actionLinks.decline)}" style="display: inline-block; padding: 12px 28px; background: #a94442; color: #fff; text-decoration: none; border-radius: 8px; margin: 6px; font-weight: bold;">DECLINE</a>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    from: FROM_ADDRESS,
    to: ownerEmail,
    subject: `New booking request: ${name} on ${date} at ${time_slot}`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Booking acknowledgement sent to client immediately on submission (PENDING)
// ---------------------------------------------------------------------------
async function sendBookingAcknowledgement(clientEmail, booking) {
  const { date, time_slot, name } = booking;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Georgia, serif; background: #faf6f1; padding: 24px; color: #3e2c1c;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e0d5c7;">
    <h2 style="color: #6b4226; margin-top: 0;">Booking Request Received</h2>
    <p>Dear ${esc(name)},</p>
    <p>Thank you for your interest in our pottery workshop! We have received your booking request and will review it shortly.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 100px;">Date</td><td style="padding: 8px 0; font-weight: bold;">${esc(date)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Time</td><td style="padding: 8px 0; font-weight: bold;">${esc(time_slot)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Duration</td><td style="padding: 8px 0;">90 minutes</td></tr>
    </table>
    <p>You will receive a confirmation email once your booking has been approved.</p>
    <p style="color: #8a7560; font-size: 14px; margin-top: 24px;">Meckata Cacicka</p>
  </div>
</body>
</html>`;

  await sendEmail({
    from: FROM_ADDRESS,
    to: clientEmail,
    subject: `Booking request received: ${date} at ${time_slot}`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Booking confirmation sent to client (with optional .ics attachment)
// ---------------------------------------------------------------------------
async function sendBookingConfirmation(recipientEmail, booking, icsContent) {
  const { date, time_slot, name } = booking;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Georgia, serif; background: #faf6f1; padding: 24px; color: #3e2c1c;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e0d5c7;">
    <h2 style="color: #6b4226; margin-top: 0;">Booking Confirmed!</h2>
    <p>Dear ${esc(name)},</p>
    <p>Your pottery workshop session has been <strong>confirmed</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 100px;">Date</td><td style="padding: 8px 0; font-weight: bold;">${esc(date)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Time</td><td style="padding: 8px 0; font-weight: bold;">${esc(time_slot)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Duration</td><td style="padding: 8px 0;">90 minutes</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Location</td><td style="padding: 8px 0;">Meckata Cacicka pottery workshop</td></tr>
    </table>
    <p>A calendar invite is attached. We look forward to seeing you!</p>
    <p style="color: #8a7560; font-size: 14px; margin-top: 24px;">Meckata Cacicka</p>
  </div>
</body>
</html>`;

  const params = {
    from: FROM_ADDRESS,
    to: recipientEmail,
    subject: `Confirmed: Pottery workshop on ${date} at ${time_slot}`,
    html,
  };

  if (icsContent) {
    params.attachments = [
      {
        filename: "workshop.ics",
        content: Buffer.from(icsContent).toString("base64"),
        content_type: "text/calendar",
      },
    ];
  }

  await sendEmail(params);
}

// ---------------------------------------------------------------------------
// Reschedule proposal sent to client with accept/decline buttons
// ---------------------------------------------------------------------------
async function sendRescheduleProposal(clientEmail, booking, newDate, newTime, responseLinks) {
  const { name, date, time_slot } = booking;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Georgia, serif; background: #faf6f1; padding: 24px; color: #3e2c1c;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e0d5c7;">
    <h2 style="color: #6b4226; margin-top: 0;">New Time Suggested</h2>
    <p>Dear ${esc(name)},</p>
    <p>Unfortunately, the requested time (<strong>${esc(date)}</strong> at <strong>${esc(time_slot)}</strong>) is not available.</p>
    <p>We would like to suggest an alternative:</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 100px;">New date</td><td style="padding: 8px 0; font-weight: bold;">${esc(newDate)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">New time</td><td style="padding: 8px 0; font-weight: bold;">${esc(newTime)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Duration</td><td style="padding: 8px 0;">90 minutes</td></tr>
    </table>
    <div style="text-align: center; margin-top: 24px;">
      <a href="${esc(responseLinks.accept)}" style="display: inline-block; padding: 12px 32px; background: #5a8f5c; color: #fff; text-decoration: none; border-radius: 8px; margin: 6px; font-weight: bold;">ACCEPT</a>
      <a href="${esc(responseLinks.decline)}" style="display: inline-block; padding: 12px 32px; background: #a94442; color: #fff; text-decoration: none; border-radius: 8px; margin: 6px; font-weight: bold;">DECLINE</a>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    from: FROM_ADDRESS,
    to: clientEmail,
    subject: `New time suggested for your pottery workshop`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Manual contact notification sent to owner (booking requires follow-up)
// ---------------------------------------------------------------------------
async function sendManualContactNotification(ownerEmail, booking) {
  const { date, time_slot, name, email, phone } = booking;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Georgia, serif; background: #faf6f1; padding: 24px; color: #3e2c1c;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e0d5c7;">
    <h2 style="color: #6b4226; margin-top: 0;">Manual Follow-Up Required</h2>
    <p>The following booking requires your direct attention. Please contact the client to arrange a suitable time.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 120px;">Name</td><td style="padding: 8px 0; font-weight: bold;">${esc(name)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Email</td><td style="padding: 8px 0;"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Phone</td><td style="padding: 8px 0;"><a href="tel:${esc(phone)}">${esc(phone)}</a></td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Requested date</td><td style="padding: 8px 0;">${esc(date)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Requested time</td><td style="padding: 8px 0;">${esc(time_slot)}</td></tr>
    </table>
  </div>
</body>
</html>`;

  await sendEmail({
    from: FROM_ADDRESS,
    to: ownerEmail,
    subject: `Action needed: contact ${name} about their booking`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Decline notification sent to client
// ---------------------------------------------------------------------------
async function sendClientDeclineNotification(clientEmail) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Georgia, serif; background: #faf6f1; padding: 24px; color: #3e2c1c;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e0d5c7;">
    <h2 style="color: #6b4226; margin-top: 0;">We Will Be in Touch</h2>
    <p>Thank you for your interest in our pottery workshop.</p>
    <p>Unfortunately, the requested time is not available. A member of our team will contact you directly to help find a suitable alternative.</p>
    <p style="color: #8a7560; font-size: 14px; margin-top: 24px;">Meckata Cacicka</p>
  </div>
</body>
</html>`;

  await sendEmail({
    from: FROM_ADDRESS,
    to: clientEmail,
    subject: "Regarding your pottery workshop booking",
    html,
  });
}

// ---------------------------------------------------------------------------
// Plain text email
// ---------------------------------------------------------------------------
async function sendPlainEmail(to, subject, text) {
  await sendEmail({
    from: FROM_ADDRESS,
    to,
    subject,
    text,
  });
}

// ---------------------------------------------------------------------------
// Confirmation to owner that reschedule suggestion was sent
// ---------------------------------------------------------------------------
async function sendSuggestionSentConfirmation(ownerEmail, booking, newDate, newTime) {
  const { name, date, time_slot } = booking;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Georgia, serif; background: #faf6f1; padding: 24px; color: #3e2c1c;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e0d5c7;">
    <h2 style="color: #6b4226; margin-top: 0;">Suggestion Sent</h2>
    <p>Your new time suggestion has been sent to <strong>${esc(name)}</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 140px;">Original time</td><td style="padding: 8px 0;">${esc(date)} at ${esc(time_slot)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Suggested time</td><td style="padding: 8px 0; font-weight: bold;">${esc(newDate)} at ${esc(newTime)}</td></tr>
    </table>
    <p>You will be notified when the client responds.</p>
  </div>
</body>
</html>`;

  await sendEmail({
    from: FROM_ADDRESS,
    to: ownerEmail,
    subject: `Reschedule suggestion sent to ${name}`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Resend send wrapper — Resend SDK v4 returns { data, error } instead of throwing
// ---------------------------------------------------------------------------
async function sendEmail(params) {
  const resend = getClient();
  const { data, error } = await resend.emails.send(params);
  if (error) {
    throw new Error(`Resend API error: ${error.message} (${error.name})`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// HTML escaping helper
// ---------------------------------------------------------------------------
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = {
  sendBookingNotification,
  sendBookingAcknowledgement,
  sendBookingConfirmation,
  sendRescheduleProposal,
  sendManualContactNotification,
  sendClientDeclineNotification,
  sendPlainEmail,
  sendSuggestionSentConfirmation,
};
