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
// i18n helper — returns cs or en string
// ---------------------------------------------------------------------------
function t(lang, cs, en) {
  return lang === "cs" ? cs : en;
}

// ---------------------------------------------------------------------------
// Shared HTML wrapper
// ---------------------------------------------------------------------------
function emailHtml(bodyContent) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Georgia, serif; background: #faf6f1; padding: 24px; color: #3e2c1c;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e0d5c7;">
    ${bodyContent}
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Owner notification: new booking received with action buttons (always English)
// ---------------------------------------------------------------------------
async function sendBookingNotification(ownerEmail, booking, actionLinks) {
  const { date, time_slot, name, email, phone } = booking;

  const html = emailHtml(`
    <h2 style="color: #6b4226; margin-top: 0;">New Booking Request</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 100px;">Name</td><td style="padding: 8px 0; font-weight: bold;">${esc(name)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Email</td><td style="padding: 8px 0;">${esc(email)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Phone</td><td style="padding: 8px 0;">${esc(phone)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Date</td><td style="padding: 8px 0; font-weight: bold;">${esc(fmtDate(date))}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Time</td><td style="padding: 8px 0; font-weight: bold;">${esc(time_slot)}</td></tr>
    </table>
    <div style="text-align: center;">
      <a href="${esc(actionLinks.accept)}" style="display: inline-block; padding: 12px 28px; background: #5a8f5c; color: #fff; text-decoration: none; border-radius: 8px; margin: 6px; font-weight: bold;">ACCEPT</a>
      <a href="${esc(actionLinks.reschedule)}" style="display: inline-block; padding: 12px 28px; background: #c4923a; color: #fff; text-decoration: none; border-radius: 8px; margin: 6px; font-weight: bold;">SUGGEST NEW TIME</a>
      <a href="${esc(actionLinks.decline)}" style="display: inline-block; padding: 12px 28px; background: #a94442; color: #fff; text-decoration: none; border-radius: 8px; margin: 6px; font-weight: bold;">DECLINE</a>
    </div>
  `);

  await sendEmail({
    from: FROM_ADDRESS,
    to: ownerEmail,
    subject: `New booking request: ${name} on ${fmtDate(date)} at ${time_slot}`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Booking acknowledgement sent to client (PENDING) — bilingual
// ---------------------------------------------------------------------------
async function sendBookingAcknowledgement(clientEmail, booking) {
  const { date, time_slot, name, lang } = booking;
  const L = lang || "en";

  const html = emailHtml(`
    <h2 style="color: #6b4226; margin-top: 0;">${t(L, "Požadavek na rezervaci přijat", "Booking Request Received")}</h2>
    <p>${t(L, `Milý/á ${esc(name)},`, `Dear ${esc(name)},`)}</p>
    <p>${t(L,
      "Děkujeme za váš zájem o náš keramický workshop! Obdrželi jsme váš požadavek na rezervaci a brzy jej posoudíme.",
      "Thank you for your interest in our pottery workshop! We have received your booking request and will review it shortly."
    )}</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 100px;">${t(L, "Datum", "Date")}</td><td style="padding: 8px 0; font-weight: bold;">${esc(fmtDate(date))}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">${t(L, "Čas", "Time")}</td><td style="padding: 8px 0; font-weight: bold;">${esc(time_slot)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">${t(L, "Délka", "Duration")}</td><td style="padding: 8px 0;">90 ${t(L, "minut", "minutes")}</td></tr>
    </table>
    <p>${t(L,
      "Jakmile bude vaše rezervace schválena, obdržíte potvrzovací e-mail.",
      "You will receive a confirmation email once your booking has been approved."
    )}</p>
    <p style="color: #8a7560; font-size: 14px; margin-top: 24px;">Meckatá Čačička</p>
  `);

  await sendEmail({
    from: FROM_ADDRESS,
    to: clientEmail,
    subject: t(L,
      `Požadavek na rezervaci přijat: ${fmtDate(date)} v ${time_slot}`,
      `Booking request received: ${fmtDate(date)} at ${time_slot}`
    ),
    html,
  });
}

// ---------------------------------------------------------------------------
// Booking confirmation sent to client (with optional .ics) — bilingual
// ---------------------------------------------------------------------------
async function sendBookingConfirmation(recipientEmail, booking, icsContent) {
  const { date, time_slot, name, lang } = booking;
  const L = lang || "en";

  const html = emailHtml(`
    <h2 style="color: #6b4226; margin-top: 0;">${t(L, "Rezervace potvrzena!", "Booking Confirmed!")}</h2>
    <p>${t(L, `Milý/á ${esc(name)},`, `Dear ${esc(name)},`)}</p>
    <p>${t(L,
      `Vaše lekce v keramickém workshopu byla <strong>potvrzena</strong>.`,
      `Your pottery workshop session has been <strong>confirmed</strong>.`
    )}</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 100px;">${t(L, "Datum", "Date")}</td><td style="padding: 8px 0; font-weight: bold;">${esc(fmtDate(date))}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">${t(L, "Čas", "Time")}</td><td style="padding: 8px 0; font-weight: bold;">${esc(time_slot)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">${t(L, "Délka", "Duration")}</td><td style="padding: 8px 0;">90 ${t(L, "minut", "minutes")}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">${t(L, "Místo", "Location")}</td><td style="padding: 8px 0;">${t(L, "Keramický workshop Meckatá Čačička", "Meckata Cacicka pottery workshop")}</td></tr>
    </table>
    <p>${t(L,
      "V příloze najdete pozvánku do kalendáře. Těšíme se na vás!",
      "A calendar invite is attached. We look forward to seeing you!"
    )}</p>
    <p style="color: #8a7560; font-size: 14px; margin-top: 24px;">Meckatá Čačička</p>
  `);

  const params = {
    from: FROM_ADDRESS,
    to: recipientEmail,
    subject: t(L,
      `Potvrzeno: Keramický workshop ${fmtDate(date)} v ${time_slot}`,
      `Confirmed: Pottery workshop on ${fmtDate(date)} at ${time_slot}`
    ),
    html,
  };

  if (icsContent) {
    params.attachments = [
      {
        filename: "workshop.ics",
        content: Buffer.from(icsContent),
        contentType: "text/calendar",
      },
    ];
  }

  await sendEmail(params);
}

// ---------------------------------------------------------------------------
// Reschedule proposal sent to client — bilingual
// ---------------------------------------------------------------------------
async function sendRescheduleProposal(clientEmail, booking, newDate, newTime, responseLinks) {
  const { name, date, time_slot, lang } = booking;
  const L = lang || "en";

  const html = emailHtml(`
    <h2 style="color: #6b4226; margin-top: 0;">${t(L, "Návrh nového termínu", "New Time Suggested")}</h2>
    <p>${t(L, `Milý/á ${esc(name)},`, `Dear ${esc(name)},`)}</p>
    <p>${t(L,
      `Bohužel požadovaný termín (<strong>${esc(fmtDate(date))}</strong> v <strong>${esc(time_slot)}</strong>) není k dispozici.`,
      `Unfortunately, the requested time (<strong>${esc(fmtDate(date))}</strong> at <strong>${esc(time_slot)}</strong>) is not available.`
    )}</p>
    <p>${t(L, "Rádi bychom vám nabídli alternativu:", "We would like to suggest an alternative:")}</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 100px;">${t(L, "Nové datum", "New date")}</td><td style="padding: 8px 0; font-weight: bold;">${esc(fmtDate(newDate))}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">${t(L, "Nový čas", "New time")}</td><td style="padding: 8px 0; font-weight: bold;">${esc(newTime)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">${t(L, "Délka", "Duration")}</td><td style="padding: 8px 0;">90 ${t(L, "minut", "minutes")}</td></tr>
    </table>
    <div style="text-align: center; margin-top: 24px;">
      <a href="${esc(responseLinks.accept)}" style="display: inline-block; padding: 12px 32px; background: #5a8f5c; color: #fff; text-decoration: none; border-radius: 8px; margin: 6px; font-weight: bold;">${t(L, "PŘIJMOUT", "ACCEPT")}</a>
      <a href="${esc(responseLinks.decline)}" style="display: inline-block; padding: 12px 32px; background: #a94442; color: #fff; text-decoration: none; border-radius: 8px; margin: 6px; font-weight: bold;">${t(L, "ODMÍTNOUT", "DECLINE")}</a>
    </div>
  `);

  await sendEmail({
    from: FROM_ADDRESS,
    to: clientEmail,
    subject: t(L,
      "Návrh nového termínu pro váš keramický workshop",
      "New time suggested for your pottery workshop"
    ),
    html,
  });
}

// ---------------------------------------------------------------------------
// Decline notification sent to client — bilingual
// ---------------------------------------------------------------------------
async function sendClientDeclineNotification(clientEmail, lang) {
  const L = lang || "en";

  const html = emailHtml(`
    <h2 style="color: #6b4226; margin-top: 0;">${t(L, "Ozveme se vám", "We Will Be in Touch")}</h2>
    <p>${t(L,
      "Děkujeme za váš zájem o náš keramický workshop.",
      "Thank you for your interest in our pottery workshop."
    )}</p>
    <p>${t(L,
      "Bohužel požadovaný termín není k dispozici. Člen našeho týmu vás bude kontaktovat přímo, abychom našli vhodnou alternativu.",
      "Unfortunately, the requested time is not available. A member of our team will contact you directly to help find a suitable alternative."
    )}</p>
    <p style="color: #8a7560; font-size: 14px; margin-top: 24px;">Meckatá Čačička</p>
  `);

  await sendEmail({
    from: FROM_ADDRESS,
    to: clientEmail,
    subject: t(L,
      "Ohledně vaší rezervace keramického workshopu",
      "Regarding your pottery workshop booking"
    ),
    html,
  });
}

// ---------------------------------------------------------------------------
// Manual contact notification sent to owner (always English)
// ---------------------------------------------------------------------------
async function sendManualContactNotification(ownerEmail, booking) {
  const { date, time_slot, name, email, phone } = booking;

  const html = emailHtml(`
    <h2 style="color: #6b4226; margin-top: 0;">Manual Follow-Up Required</h2>
    <p>The following booking requires your direct attention. Please contact the client to arrange a suitable time.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 120px;">Name</td><td style="padding: 8px 0; font-weight: bold;">${esc(name)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Email</td><td style="padding: 8px 0;"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Phone</td><td style="padding: 8px 0;"><a href="tel:${esc(phone)}">${esc(phone)}</a></td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Requested date</td><td style="padding: 8px 0;">${esc(fmtDate(date))}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Requested time</td><td style="padding: 8px 0;">${esc(time_slot)}</td></tr>
    </table>
  `);

  await sendEmail({
    from: FROM_ADDRESS,
    to: ownerEmail,
    subject: `Action needed: contact ${name} about their booking`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Owner notification: booking accepted and confirmed (always English)
// ---------------------------------------------------------------------------
async function sendBookingAcceptedNotification(ownerEmail, booking, icsContent) {
  const { date, time_slot, name, email, phone } = booking;

  const html = emailHtml(`
    <h2 style="color: #5a8f5c; margin-top: 0;">Booking Confirmed</h2>
    <p>You have accepted the booking. A confirmation email with a calendar invite has been sent to the client.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 100px;">Client</td><td style="padding: 8px 0; font-weight: bold;">${esc(name)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Email</td><td style="padding: 8px 0;">${esc(email)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Phone</td><td style="padding: 8px 0;">${esc(phone)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Date</td><td style="padding: 8px 0; font-weight: bold;">${esc(fmtDate(date))}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Time</td><td style="padding: 8px 0; font-weight: bold;">${esc(time_slot)}</td></tr>
    </table>
    <p style="color: #8a7560; font-size: 14px; margin-top: 24px;">Meckata Cacicka</p>
  `);

  const params = {
    from: FROM_ADDRESS,
    to: ownerEmail,
    subject: `Booking confirmed: ${name} on ${fmtDate(date)} at ${time_slot}`,
    html,
  };

  if (icsContent) {
    params.attachments = [
      { filename: "workshop.ics", content: Buffer.from(icsContent), contentType: "text/calendar" },
    ];
  }

  await sendEmail(params);
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
// Confirmation to owner that reschedule suggestion was sent (always English)
// ---------------------------------------------------------------------------
async function sendSuggestionSentConfirmation(ownerEmail, booking, newDate, newTime) {
  const { name, date, time_slot } = booking;

  const html = emailHtml(`
    <h2 style="color: #6b4226; margin-top: 0;">Suggestion Sent</h2>
    <p>Your new time suggestion has been sent to <strong>${esc(name)}</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 140px;">Original time</td><td style="padding: 8px 0;">${esc(fmtDate(date))} at ${esc(time_slot)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Suggested time</td><td style="padding: 8px 0; font-weight: bold;">${esc(fmtDate(newDate))} at ${esc(newTime)}</td></tr>
    </table>
    <p>You will be notified when the client responds.</p>
  `);

  await sendEmail({
    from: FROM_ADDRESS,
    to: ownerEmail,
    subject: `Reschedule suggestion sent to ${name}`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Owner notification: client accepted the suggested reschedule time (always English)
// ---------------------------------------------------------------------------
async function sendRescheduleAcceptedNotification(ownerEmail, booking, newDate, newTime, icsContent) {
  const { name, email, phone } = booking;

  const html = emailHtml(`
    <h2 style="color: #5a8f5c; margin-top: 0;">Client Accepted Your Suggested Time</h2>
    <p><strong>${esc(name)}</strong> has accepted your proposed new time. The booking is now confirmed.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px 0; color: #8a7560; width: 100px;">Client</td><td style="padding: 8px 0; font-weight: bold;">${esc(name)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Email</td><td style="padding: 8px 0;">${esc(email)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Phone</td><td style="padding: 8px 0;">${esc(phone)}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Date</td><td style="padding: 8px 0; font-weight: bold;">${esc(fmtDate(newDate))}</td></tr>
      <tr><td style="padding: 8px 0; color: #8a7560;">Time</td><td style="padding: 8px 0; font-weight: bold;">${esc(newTime)}</td></tr>
    </table>
    <p>A confirmation email with a calendar invite has been sent to the client.</p>
    <p style="color: #8a7560; font-size: 14px; margin-top: 24px;">Meckata Cacicka</p>
  `);

  const params = {
    from: FROM_ADDRESS,
    to: ownerEmail,
    subject: `${name} accepted: ${fmtDate(newDate)} at ${newTime}`,
    html,
  };

  if (icsContent) {
    params.attachments = [
      { filename: "workshop.ics", content: Buffer.from(icsContent), contentType: "text/calendar" },
    ];
  }

  await sendEmail(params);
}

// ---------------------------------------------------------------------------
// Resend send wrapper — Resend SDK v4 returns { data, error } instead of throwing
// ---------------------------------------------------------------------------
async function sendEmail(params) {
  const resend = getClient();
  console.log(`Sending email to=${params.to} subject="${params.subject}"`);
  const { data, error } = await resend.emails.send(params);
  if (error) {
    console.error(`Resend error: to=${params.to} error=${JSON.stringify(error)}`);
    throw new Error(`Resend API error: ${error.message} (${error.name})`);
  }
  console.log(`Email sent: to=${params.to} id=${data?.id}`);
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

/** Convert YYYY-MM-DD to dd/mm/yyyy */
function fmtDate(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

module.exports = {
  sendBookingNotification,
  sendBookingAcknowledgement,
  sendBookingConfirmation,
  sendBookingAcceptedNotification,
  sendRescheduleProposal,
  sendRescheduleAcceptedNotification,
  sendManualContactNotification,
  sendClientDeclineNotification,
  sendPlainEmail,
  sendSuggestionSentConfirmation,
};
