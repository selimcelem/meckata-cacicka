"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");
const { generateIcs } = require("./ics");
const {
  sendBookingNotification,
  sendBookingConfirmation,
  sendRescheduleProposal,
  sendManualContactNotification,
  sendClientDeclineNotification,
  sendSuggestionSentConfirmation,
} = require("./email");

// ---------------------------------------------------------------------------
// AWS clients
// ---------------------------------------------------------------------------
const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const TABLE_NAME = process.env.TABLE_NAME;
const OWNER_EMAIL = process.env.OWNER_EMAIL;
const API_DOMAIN = process.env.API_DOMAIN;

const SLOTS_BY_DAY = {
  1: ["17:00", "18:30"], // Monday
  2: ["17:00", "18:30"],
  3: ["17:00", "18:30"],
  4: ["17:00", "18:30"],
  5: ["17:00", "18:30"], // Friday
  6: ["10:00", "13:00", "15:00"], // Saturday
  0: ["10:00", "13:00", "15:00"], // Sunday
};

const ALL_VALID_SLOTS = new Set(["10:00", "13:00", "15:00", "17:00", "18:30"]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return current date-time in Europe/Prague as an ISO-ish string. */
function pragueNow() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Prague" })
  );
}

function respond(statusCode, body, extraHeaders) {
  const isHtml =
    typeof body === "string" && body.trimStart().startsWith("<");
  return {
    statusCode,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": isHtml ? "text/html; charset=utf-8" : "application/json",
      ...extraHeaders,
    },
    body: isHtml ? body : JSON.stringify(body),
  };
}

function respondHtml(statusCode, title, bodyContent) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)} - Meckata Cacicka</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; background: #faf6f1; color: #3e2c1c; margin: 0; padding: 24px; }
    .card { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 12px; padding: 40px; border: 1px solid #e0d5c7; box-shadow: 0 2px 12px rgba(107,66,38,0.08); }
    h1 { color: #6b4226; font-size: 24px; margin-top: 0; }
    .success { color: #5a8f5c; }
    .info { color: #8a7560; }
    label { display: block; margin-top: 16px; color: #6b4226; font-weight: bold; font-size: 14px; }
    input, select { width: 100%; padding: 10px 12px; margin-top: 4px; border: 1px solid #d4c8b8; border-radius: 6px; font-size: 16px; font-family: inherit; }
    input:focus, select:focus { outline: none; border-color: #6b4226; box-shadow: 0 0 0 2px rgba(107,66,38,0.15); }
    .btn { display: inline-block; padding: 12px 32px; background: #6b4226; color: #fff; border: none; border-radius: 8px; font-size: 16px; font-family: inherit; cursor: pointer; font-weight: bold; margin-top: 24px; }
    .btn:hover { background: #5a3720; }
    .footer { text-align: center; margin-top: 32px; color: #8a7560; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    ${bodyContent}
  </div>
  <div class="footer">Meckata Cacicka Pottery Workshop</div>
</body>
</html>`;
  return respond(statusCode, html);
}

function escHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function slotsForDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay();
  return SLOTS_BY_DAY[dow] || [];
}

function isDateInPast(dateStr, timeSlot) {
  const now = pragueNow();
  const [h, m] = timeSlot.split(":").map(Number);
  const slotDate = new Date(dateStr + "T00:00:00");
  slotDate.setHours(h, m, 0, 0);
  return slotDate <= now;
}

function tokenExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// GSI query helpers
// ---------------------------------------------------------------------------

async function queryByMonth(month) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "month-index",
      KeyConditionExpression: "#m = :month",
      ExpressionAttributeNames: { "#m": "month" },
      ExpressionAttributeValues: { ":month": month },
    })
  );
  return result.Items || [];
}

async function queryByToken(token) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "token-index",
      KeyConditionExpression: "#t = :token",
      ExpressionAttributeNames: { "#t": "token" },
      ExpressionAttributeValues: { ":token": token },
    })
  );
  return result.Items && result.Items.length > 0 ? result.Items[0] : null;
}

async function queryByCustomerToken(customerToken) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "customer-token-index",
      KeyConditionExpression: "#ct = :ct",
      ExpressionAttributeNames: { "#ct": "customer_token" },
      ExpressionAttributeValues: { ":ct": customerToken },
    })
  );
  return result.Items && result.Items.length > 0 ? result.Items[0] : null;
}

async function isSlotTaken(date, timeSlot) {
  // Direct get on composite key (date + time_slot)
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { date, time_slot: timeSlot },
    })
  );
  return result.Item && result.Item.status !== "CANCELLED";
}

// ---------------------------------------------------------------------------
// Route: GET /slots
// ---------------------------------------------------------------------------
async function handleGetSlots(event) {
  const month = event.queryStringParameters && event.queryStringParameters.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return respond(400, { error: "Query parameter 'month' is required in YYYY-MM format." });
  }

  const [yearStr, monthStr] = month.split("-");
  const year = parseInt(yearStr, 10);
  const mon = parseInt(monthStr, 10);
  const totalDays = daysInMonth(year, mon);

  // Fetch existing bookings for the month
  const bookings = await queryByMonth(month);
  const takenSlots = new Set();
  for (const b of bookings) {
    if (b.status !== "CANCELLED") {
      takenSlots.add(`${b.date}|${b.time_slot}`);
    }
  }

  const now = pragueNow();
  const availability = {};

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${yearStr}-${monthStr}-${String(day).padStart(2, "0")}`;
    const slots = slotsForDate(dateStr);
    const available = [];

    for (const slot of slots) {
      const key = `${dateStr}|${slot}`;
      if (takenSlots.has(key)) continue;

      // Grey out past date/times
      const [h, m] = slot.split(":").map(Number);
      const slotDt = new Date(dateStr + "T00:00:00");
      slotDt.setHours(h, m, 0, 0);
      if (slotDt <= now) continue;

      available.push(slot);
    }

    if (available.length > 0) {
      availability[dateStr] = available;
    }
  }

  return respond(200, { month, availability });
}

// ---------------------------------------------------------------------------
// Route: POST /booking
// ---------------------------------------------------------------------------
async function handlePostBooking(event) {
  const body = parseBody(event);
  const { date, time_slot, name, email, phone } = body;

  // Validate required fields
  if (!date || !time_slot || !name || !email || !phone) {
    return respond(400, { error: "All fields are required: date, time_slot, name, email, phone." });
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return respond(400, { error: "Invalid date format. Use YYYY-MM-DD." });
  }

  // Validate time slot
  if (!ALL_VALID_SLOTS.has(time_slot)) {
    return respond(400, { error: `Invalid time_slot. Valid slots: ${[...ALL_VALID_SLOTS].join(", ")}` });
  }

  // Check time_slot is valid for the day of week
  const validSlotsForDay = slotsForDate(date);
  if (!validSlotsForDay.includes(time_slot)) {
    return respond(400, { error: `Time slot ${time_slot} is not available on the selected day. Available: ${validSlotsForDay.join(", ")}` });
  }

  // Check not in the past
  if (isDateInPast(date, time_slot)) {
    return respond(400, { error: "Cannot book a time in the past." });
  }

  const token = uuidv4();
  const month = date.slice(0, 7);
  const now = new Date().toISOString();

  const item = {
    date,
    time_slot,
    name,
    email,
    phone,
    status: "PENDING",
    token,
    token_expires_at: tokenExpiryDate(),
    month,
    created_at: now,
  };

  // Conditional put: prevent double-booking
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: "attribute_not_exists(#d) OR #s = :cancelled",
        ExpressionAttributeNames: { "#d": "date", "#s": "status" },
        ExpressionAttributeValues: { ":cancelled": "CANCELLED" },
      })
    );
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return respond(409, { error: "This time slot is already booked." });
    }
    throw err;
  }

  // Build action links
  const actionLinks = {
    accept: `https://${API_DOMAIN}/prod/action?token=${token}&action=accept`,
    reschedule: `https://${API_DOMAIN}/prod/reschedule?token=${token}`,
    decline: `https://${API_DOMAIN}/prod/action?token=${token}&action=reject`,
  };

  // Send emails (non-blocking failures should not break the booking)
  try {
    await Promise.all([
      sendBookingNotification(OWNER_EMAIL, item, actionLinks),
      sendBookingConfirmation(email, item, null),
    ]);
  } catch (emailErr) {
    console.error("Email sending failed:", emailErr);
  }

  return respond(201, {
    message: "Booking request submitted successfully.",
    booking: { date, time_slot, name, email, phone, status: "PENDING" },
  });
}

// ---------------------------------------------------------------------------
// Route: GET /action
// ---------------------------------------------------------------------------
async function handleAction(event) {
  const params = event.queryStringParameters || {};
  const { token, action } = params;

  if (!token || !action) {
    return respondHtml(400, "Invalid Request", "<h1>Invalid Request</h1><p>Missing token or action.</p>");
  }

  if (action !== "accept" && action !== "reject") {
    return respondHtml(400, "Invalid Action", "<h1>Invalid Action</h1><p>Action must be 'accept' or 'reject'.</p>");
  }

  const booking = await queryByToken(token);
  if (!booking) {
    return respondHtml(404, "Not Found", "<h1>Booking Not Found</h1><p>This link is invalid or the booking no longer exists.</p>");
  }

  if (new Date(booking.token_expires_at) < new Date()) {
    return respondHtml(410, "Expired", "<h1>Link Expired</h1><p>This action link has expired. Please manage the booking manually.</p>");
  }

  if (booking.status !== "PENDING") {
    return respondHtml(409, "Already Processed", `<h1>Already Processed</h1><p>This booking has already been processed (status: ${escHtml(booking.status)}).</p>`);
  }

  if (action === "accept") {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { date: booking.date, time_slot: booking.time_slot },
        UpdateExpression: "SET #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":status": "CONFIRMED" },
      })
    );

    const icsContent = generateIcs(booking.date, booking.time_slot, booking.name, booking.email);

    try {
      await Promise.all([
        sendBookingConfirmation(booking.email, booking, icsContent),
        sendBookingConfirmation(OWNER_EMAIL, booking, icsContent),
      ]);
    } catch (emailErr) {
      console.error("Confirmation email failed:", emailErr);
    }

    return respondHtml(200, "Booking Accepted", `
      <h1 class="success">Booking Accepted</h1>
      <p>The booking for <strong>${escHtml(booking.name)}</strong> on <strong>${escHtml(booking.date)}</strong> at <strong>${escHtml(booking.time_slot)}</strong> has been confirmed.</p>
      <p>Confirmation emails with calendar invites have been sent to both you and the client.</p>
    `);
  }

  // action === "reject"
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { date: booking.date, time_slot: booking.time_slot },
      UpdateExpression: "SET #s = :status",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":status": "REQUIRES_MANUAL_CONTACT" },
    })
  );

  try {
    await Promise.all([
      sendClientDeclineNotification(booking.email),
      sendManualContactNotification(OWNER_EMAIL, booking),
    ]);
  } catch (emailErr) {
    console.error("Decline email failed:", emailErr);
  }

  return respondHtml(200, "Booking Declined", `
    <h1>Booking Declined</h1>
    <p>The booking for <strong>${escHtml(booking.name)}</strong> has been declined.</p>
    <p>The client has been notified that you will contact them directly. Their full contact details have been sent to your email.</p>
  `);
}

// ---------------------------------------------------------------------------
// Route: GET /reschedule (form)
// ---------------------------------------------------------------------------
async function handleRescheduleForm(event) {
  const params = event.queryStringParameters || {};
  const { token } = params;

  if (!token) {
    return respondHtml(400, "Invalid Request", "<h1>Invalid Request</h1><p>Missing token.</p>");
  }

  const booking = await queryByToken(token);
  if (!booking) {
    return respondHtml(404, "Not Found", "<h1>Booking Not Found</h1><p>This link is invalid or the booking no longer exists.</p>");
  }

  if (new Date(booking.token_expires_at) < new Date()) {
    return respondHtml(410, "Expired", "<h1>Link Expired</h1><p>This action link has expired.</p>");
  }

  if (booking.status !== "PENDING") {
    return respondHtml(409, "Already Processed", `<h1>Already Processed</h1><p>This booking has already been processed (status: ${escHtml(booking.status)}).</p>`);
  }

  const formHtml = `
    <h1>Suggest New Time</h1>
    <p>Current request from <strong>${escHtml(booking.name)}</strong>: ${escHtml(booking.date)} at ${escHtml(booking.time_slot)}</p>
    <form id="rescheduleForm" onsubmit="submitForm(event)">
      <label for="suggested_date">New Date</label>
      <input type="date" id="suggested_date" name="suggested_date" required>

      <label for="suggested_time_slot">New Time Slot</label>
      <select id="suggested_time_slot" name="suggested_time_slot" required>
        <option value="">Select a time...</option>
        <option value="10:00">10:00 (Weekends)</option>
        <option value="13:00">13:00 (Weekends)</option>
        <option value="15:00">15:00 (Weekends)</option>
        <option value="17:00">17:00 (Weekdays)</option>
        <option value="18:30">18:30 (Weekdays)</option>
      </select>

      <button type="submit" class="btn">Send Suggestion</button>
      <p id="message" style="margin-top: 16px;"></p>
    </form>
    <script>
      async function submitForm(e) {
        e.preventDefault();
        const msg = document.getElementById('message');
        msg.textContent = 'Sending...';
        try {
          const res = await fetch(window.location.origin + '/prod/reschedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: '${token}',
              suggested_date: document.getElementById('suggested_date').value,
              suggested_time_slot: document.getElementById('suggested_time_slot').value
            })
          });
          if (res.ok) {
            document.getElementById('rescheduleForm').innerHTML = '<h2 class="success">Suggestion Sent!</h2><p>The client has been emailed with your proposed new time.</p>';
          } else {
            const data = await res.json();
            msg.textContent = data.error || 'Something went wrong.';
            msg.style.color = '#a94442';
          }
        } catch (err) {
          msg.textContent = 'Network error. Please try again.';
          msg.style.color = '#a94442';
        }
      }
    </script>
  `;

  return respondHtml(200, "Suggest New Time", formHtml);
}

// ---------------------------------------------------------------------------
// Route: POST /reschedule
// ---------------------------------------------------------------------------
async function handlePostReschedule(event) {
  const body = parseBody(event);
  const { token, suggested_date, suggested_time_slot } = body;

  if (!token || !suggested_date || !suggested_time_slot) {
    return respond(400, { error: "Fields required: token, suggested_date, suggested_time_slot." });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(suggested_date)) {
    return respond(400, { error: "Invalid date format. Use YYYY-MM-DD." });
  }

  if (!ALL_VALID_SLOTS.has(suggested_time_slot)) {
    return respond(400, { error: `Invalid time slot. Valid slots: ${[...ALL_VALID_SLOTS].join(", ")}` });
  }

  const validSlotsForDay = slotsForDate(suggested_date);
  if (!validSlotsForDay.includes(suggested_time_slot)) {
    return respond(400, { error: `Time slot ${suggested_time_slot} is not available on the selected day.` });
  }

  if (isDateInPast(suggested_date, suggested_time_slot)) {
    return respond(400, { error: "Cannot suggest a time in the past." });
  }

  const booking = await queryByToken(token);
  if (!booking) {
    return respond(404, { error: "Booking not found." });
  }

  if (new Date(booking.token_expires_at) < new Date()) {
    return respond(410, { error: "Token has expired." });
  }

  if (booking.status !== "PENDING") {
    return respond(409, { error: `Booking has already been processed (status: ${booking.status}).` });
  }

  // Check proposed slot is available
  const taken = await isSlotTaken(suggested_date, suggested_time_slot);
  if (taken) {
    return respond(409, { error: "The suggested time slot is already booked." });
  }

  const customerToken = uuidv4();
  const customerTokenExpiresAt = tokenExpiryDate();

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { date: booking.date, time_slot: booking.time_slot },
      UpdateExpression:
        "SET #s = :status, suggested_date = :sd, suggested_time_slot = :sts, customer_token = :ct, customer_token_expires_at = :cte",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":status": "RESCHEDULED_PENDING",
        ":sd": suggested_date,
        ":sts": suggested_time_slot,
        ":ct": customerToken,
        ":cte": customerTokenExpiresAt,
      },
    })
  );

  const responseLinks = {
    accept: `https://${API_DOMAIN}/prod/respond?token=${customerToken}&action=accept`,
    decline: `https://${API_DOMAIN}/prod/respond?token=${customerToken}&action=reject`,
  };

  try {
    await Promise.all([
      sendRescheduleProposal(booking.email, booking, suggested_date, suggested_time_slot, responseLinks),
      sendSuggestionSentConfirmation(OWNER_EMAIL, booking, suggested_date, suggested_time_slot),
    ]);
  } catch (emailErr) {
    console.error("Reschedule email failed:", emailErr);
  }

  return respond(200, { message: "Reschedule suggestion sent to client." });
}

// ---------------------------------------------------------------------------
// Route: GET /respond
// ---------------------------------------------------------------------------
async function handleRespond(event) {
  const params = event.queryStringParameters || {};
  const { token, action } = params;

  if (!token || !action) {
    return respondHtml(400, "Invalid Request", "<h1>Invalid Request</h1><p>Missing token or action.</p>");
  }

  if (action !== "accept" && action !== "reject") {
    return respondHtml(400, "Invalid Action", "<h1>Invalid Action</h1><p>Action must be 'accept' or 'reject'.</p>");
  }

  const booking = await queryByCustomerToken(token);
  if (!booking) {
    return respondHtml(404, "Not Found", "<h1>Not Found</h1><p>This link is invalid or the booking no longer exists.</p>");
  }

  if (new Date(booking.customer_token_expires_at) < new Date()) {
    return respondHtml(410, "Expired", "<h1>Link Expired</h1><p>This response link has expired. Please contact the workshop directly.</p>");
  }

  if (booking.status !== "RESCHEDULED_PENDING") {
    return respondHtml(409, "Already Processed", `<h1>Already Processed</h1><p>This booking has already been processed (status: ${escHtml(booking.status)}).</p>`);
  }

  if (action === "accept") {
    // Cancel original booking
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { date: booking.date, time_slot: booking.time_slot },
        UpdateExpression: "SET #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":status": "CANCELLED" },
      })
    );

    // Create new booking at the suggested time
    const newToken = uuidv4();
    const newMonth = booking.suggested_date.slice(0, 7);
    const now = new Date().toISOString();

    const newItem = {
      date: booking.suggested_date,
      time_slot: booking.suggested_time_slot,
      name: booking.name,
      email: booking.email,
      phone: booking.phone,
      status: "CONFIRMED",
      token: newToken,
      token_expires_at: tokenExpiryDate(),
      month: newMonth,
      created_at: now,
    };

    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: newItem,
          ConditionExpression: "attribute_not_exists(#d) OR #s = :cancelled",
          ExpressionAttributeNames: { "#d": "date", "#s": "status" },
          ExpressionAttributeValues: { ":cancelled": "CANCELLED" },
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return respondHtml(409, "Slot Taken", "<h1>Time Slot No Longer Available</h1><p>Unfortunately, the suggested time has been booked by someone else. The workshop will contact you directly.</p>");
      }
      throw err;
    }

    const icsContent = generateIcs(
      booking.suggested_date,
      booking.suggested_time_slot,
      booking.name,
      booking.email
    );

    try {
      const confirmedBooking = {
        ...booking,
        date: booking.suggested_date,
        time_slot: booking.suggested_time_slot,
      };
      await Promise.all([
        sendBookingConfirmation(booking.email, confirmedBooking, icsContent),
        sendBookingConfirmation(OWNER_EMAIL, confirmedBooking, icsContent),
      ]);
    } catch (emailErr) {
      console.error("Confirmation email failed:", emailErr);
    }

    return respondHtml(200, "Booking Confirmed", `
      <h1 class="success">Booking Confirmed!</h1>
      <p>Your pottery workshop session has been confirmed for:</p>
      <p><strong>${escHtml(booking.suggested_date)}</strong> at <strong>${escHtml(booking.suggested_time_slot)}</strong></p>
      <p>A confirmation email with a calendar invite has been sent to you.</p>
      <p class="info">We look forward to seeing you!</p>
    `);
  }

  // action === "reject"
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { date: booking.date, time_slot: booking.time_slot },
      UpdateExpression: "SET #s = :status",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":status": "REQUIRES_MANUAL_CONTACT" },
    })
  );

  try {
    await Promise.all([
      sendClientDeclineNotification(booking.email),
      sendManualContactNotification(OWNER_EMAIL, booking),
    ]);
  } catch (emailErr) {
    console.error("Decline email failed:", emailErr);
  }

  return respondHtml(200, "Response Received", `
    <h1>Thank You</h1>
    <p>We understand the suggested time does not work for you.</p>
    <p>A member of our team will contact you directly to find a time that suits you.</p>
    <p class="info">Meckata Cacicka Pottery Workshop</p>
  `);
}

// ---------------------------------------------------------------------------
// Lambda entry point
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  const method = event.httpMethod;
  const resource = event.resource || event.path || "";

  // Handle OPTIONS preflight
  if (method === "OPTIONS") {
    return respond(204, "");
  }

  try {
    // GET /slots
    if (method === "GET" && resource === "/slots") {
      return await handleGetSlots(event);
    }

    // POST /booking
    if (method === "POST" && resource === "/booking") {
      return await handlePostBooking(event);
    }

    // GET /action
    if (method === "GET" && resource === "/action") {
      return await handleAction(event);
    }

    // GET /reschedule
    if (method === "GET" && resource === "/reschedule") {
      return await handleRescheduleForm(event);
    }

    // POST /reschedule
    if (method === "POST" && resource === "/reschedule") {
      return await handlePostReschedule(event);
    }

    // GET /respond
    if (method === "GET" && resource === "/respond") {
      return await handleRespond(event);
    }

    return respond(404, { error: "Not found." });
  } catch (err) {
    console.error("Unhandled error:", err);
    return respond(500, { error: "Internal server error." });
  }
};
