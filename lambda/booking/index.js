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
  sendBookingAcknowledgement,
  sendBookingConfirmation,
  sendBookingAcceptedNotification,
  sendRescheduleProposal,
  sendRescheduleAcceptedNotification,
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

// Statuses that block a time slot from being booked
const ACTIVE_STATUSES = new Set(["PENDING", "CONFIRMED", "RESCHEDULED_PENDING"]);

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

/** Convert YYYY-MM-DD to dd/mm/yyyy */
function fmtDate(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
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
  return result.Item && ACTIVE_STATUSES.has(result.Item.status);
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
    if (ACTIVE_STATUSES.has(b.status)) {
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
  const { date, time_slot, name, phone } = body;
  const clientEmail = (body.email || "").trim();
  const lang = body.lang === "cs" ? "cs" : "en";

  // Validate required fields
  if (!date || !time_slot || !name || !clientEmail || !phone) {
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
    email: clientEmail,
    phone,
    lang,
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
        ConditionExpression: "attribute_not_exists(#d) OR (NOT #s IN (:pending, :confirmed, :rescheduled))",
        ExpressionAttributeNames: { "#d": "date", "#s": "status" },
        ExpressionAttributeValues: { ":pending": "PENDING", ":confirmed": "CONFIRMED", ":rescheduled": "RESCHEDULED_PENDING" },
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
      sendBookingAcknowledgement(clientEmail, item),
    ]);
  } catch (emailErr) {
    console.error("Email sending failed:", emailErr);
  }

  return respond(201, {
    message: "Booking request submitted successfully.",
    booking: { date, time_slot, name, email: clientEmail, phone, status: "PENDING" },
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
        sendBookingAcceptedNotification(OWNER_EMAIL, booking, icsContent),
      ]);
    } catch (emailErr) {
      console.error("Confirmation email failed:", emailErr);
    }

    return respondHtml(200, "Booking Accepted", `
      <h1 class="success">Booking Accepted</h1>
      <p>The booking for <strong>${escHtml(booking.name)}</strong> on <strong>${escHtml(fmtDate(booking.date))}</strong> at <strong>${escHtml(booking.time_slot)}</strong> has been confirmed.</p>
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
      ExpressionAttributeValues: { ":status": "DECLINED" },
    })
  );

  try {
    await Promise.all([
      sendClientDeclineNotification(booking.email, booking.lang),
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
    <p>Current request from <strong>${escHtml(booking.name)}</strong>: ${escHtml(fmtDate(booking.date))} at ${escHtml(booking.time_slot)}</p>

    <style>
      .cal-header { display:flex; align-items:center; justify-content:space-between; margin:16px 0 12px; }
      .cal-title { font-size:1.15rem; color:#6b4226; font-weight:700; }
      .cal-nav { width:36px; height:36px; border-radius:50%; background:#fff; border:1px solid rgba(139,94,60,0.2); display:flex; align-items:center; justify-content:center; font-size:1rem; color:#6b4226; cursor:pointer; transition:all .2s; }
      .cal-nav:hover { background:#c67b5c; color:#fff; border-color:#c67b5c; }
      .cal-weekdays { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; margin-bottom:4px; }
      .cal-wd { text-align:center; font-weight:600; font-size:0.8rem; color:#6b4226; padding:4px 0; text-transform:uppercase; letter-spacing:0.05em; }
      .cal-days { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
      .cal-day { aspect-ratio:1; display:flex; align-items:center; justify-content:center; border-radius:8px; font-weight:500; font-size:0.9rem; background:#fff; border:2px solid transparent; cursor:default; transition:all .2s; }
      .cal-day.empty { background:transparent; }
      .cal-day.avail { cursor:pointer; color:#3e2c1c; }
      .cal-day.avail:hover { background:rgba(198,123,92,0.12); border-color:#c67b5c; }
      .cal-day.sel { background:#c67b5c !important; color:#fff !important; border-color:#c67b5c !important; }
      .cal-day.past { color:#C5BFBA; background:rgba(0,0,0,0.02); }
      .cal-day.today { border-color:#8fae82; font-weight:700; }
      .ts-grid { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
      .ts-btn { padding:10px 20px; border-radius:8px; border:2px solid #d4c8b8; background:#fff; font-size:1rem; font-family:inherit; cursor:pointer; transition:all .2s; color:#3e2c1c; }
      .ts-btn:hover { border-color:#c67b5c; background:rgba(198,123,92,0.08); }
      .ts-btn.sel { background:#c67b5c; color:#fff; border-color:#c67b5c; }
      #timeslots, #submit-section { display:none; }
      .summary { margin-top:16px; padding:12px 16px; background:rgba(198,123,92,0.08); border-radius:8px; font-size:0.95rem; }
    </style>

    <div id="rescheduleForm">
      <label>Select a new date</label>
      <div class="cal-header">
        <button type="button" class="cal-nav" id="cal-prev">&larr;</button>
        <span class="cal-title" id="cal-title"></span>
        <button type="button" class="cal-nav" id="cal-next">&rarr;</button>
      </div>
      <div class="cal-weekdays" id="cal-weekdays"></div>
      <div class="cal-days" id="cal-days"></div>

      <div id="timeslots">
        <label id="ts-label"></label>
        <div class="ts-grid" id="ts-grid"></div>
      </div>

      <div id="submit-section">
        <div class="summary" id="summary"></div>
        <button type="button" class="btn" id="send-btn">Send Suggestion</button>
      </div>
      <p id="message" style="margin-top:16px;"></p>
    </div>

    <script>
    (function(){
      var SLOTS_BY_DAY = {1:['17:00','18:30'],2:['17:00','18:30'],3:['17:00','18:30'],4:['17:00','18:30'],5:['17:00','18:30'],6:['10:00','13:00','15:00'],0:['10:00','13:00','15:00']};
      var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      var WDAYS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
      var now = new Date();
      var curYear = now.getFullYear(), curMonth = now.getMonth();
      var selDate = null, selTime = null;

      function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
      function pad(n) { return n < 10 ? '0'+n : ''+n; }
      function fmtEu(iso) { var p=iso.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; }

      function render() {
        document.getElementById('cal-title').textContent = MONTHS[curMonth] + ' ' + curYear;
        document.getElementById('cal-weekdays').innerHTML = WDAYS.map(function(d){ return '<div class="cal-wd">'+d+'</div>'; }).join('');

        var first = new Date(curYear, curMonth, 1);
        var total = new Date(curYear, curMonth+1, 0).getDate();
        var startDow = first.getDay() - 1; if (startDow < 0) startDow = 6;
        var t = today();
        var html = '';
        for (var i=0; i<startDow; i++) html += '<div class="cal-day empty"></div>';
        for (var day=1; day<=total; day++) {
          var date = new Date(curYear, curMonth, day);
          var isPast = date < t;
          var isToday = date.getTime() === t.getTime();
          var dow = date.getDay();
          var hasSlots = SLOTS_BY_DAY[dow] && SLOTS_BY_DAY[dow].length > 0;
          var isAvail = !isPast && hasSlots;
          var isoStr = curYear+'-'+pad(curMonth+1)+'-'+pad(day);
          var isSel = selDate === isoStr;
          var cls = 'cal-day';
          if (isPast) cls += ' past';
          if (isToday) cls += ' today';
          if (isAvail) cls += ' avail';
          if (isSel) cls += ' sel';
          if (isAvail) {
            html += '<div class="'+cls+'" data-date="'+isoStr+'">'+day+'</div>';
          } else {
            html += '<div class="'+cls+'">'+day+'</div>';
          }
        }
        document.getElementById('cal-days').innerHTML = html;

        document.querySelectorAll('.cal-day.avail').forEach(function(el){
          el.addEventListener('click', function(){ selDate = el.dataset.date; selTime = null; render(); });
        });

        renderSlots();
        renderSubmit();
      }

      function renderSlots() {
        var container = document.getElementById('timeslots');
        var grid = document.getElementById('ts-grid');
        if (!selDate) { container.style.display = 'none'; return; }
        container.style.display = 'block';
        var d = new Date(selDate+'T12:00:00');
        var slots = SLOTS_BY_DAY[d.getDay()] || [];
        document.getElementById('ts-label').textContent = 'Available times — ' + fmtEu(selDate);
        grid.innerHTML = slots.map(function(s){
          var cls = 'ts-btn' + (selTime === s ? ' sel' : '');
          return '<button type="button" class="'+cls+'" data-time="'+s+'">'+s+'</button>';
        }).join('');
        grid.querySelectorAll('.ts-btn').forEach(function(btn){
          btn.addEventListener('click', function(){ selTime = btn.dataset.time; renderSlots(); renderSubmit(); });
        });
      }

      function renderSubmit() {
        var sec = document.getElementById('submit-section');
        if (!selDate || !selTime) { sec.style.display = 'none'; return; }
        sec.style.display = 'block';
        document.getElementById('summary').innerHTML = '<strong>New time:</strong> ' + fmtEu(selDate) + ' at ' + selTime;
      }

      document.getElementById('cal-prev').addEventListener('click', function(){
        curMonth--; if (curMonth<0){ curMonth=11; curYear--; } selDate=null; selTime=null; render();
      });
      document.getElementById('cal-next').addEventListener('click', function(){
        curMonth++; if (curMonth>11){ curMonth=0; curYear++; } selDate=null; selTime=null; render();
      });

      document.getElementById('send-btn').addEventListener('click', async function(){
        var msg = document.getElementById('message');
        if (!selDate || !selTime) return;
        msg.textContent = 'Sending...'; msg.style.color = '';
        try {
          var res = await fetch(window.location.origin + '/prod/reschedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: '${token}', suggested_date: selDate, suggested_time_slot: selTime })
          });
          if (res.ok) {
            document.getElementById('rescheduleForm').innerHTML = '<h2 class="success">Suggestion Sent!</h2><p>The client has been emailed with your proposed new time.</p>';
          } else {
            var data = await res.json();
            msg.textContent = data.error || 'Something went wrong.';
            msg.style.color = '#a94442';
          }
        } catch(err) {
          msg.textContent = 'Network error. Please try again.';
          msg.style.color = '#a94442';
        }
      });

      render();
    })();
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
        sendRescheduleAcceptedNotification(OWNER_EMAIL, booking, booking.suggested_date, booking.suggested_time_slot, icsContent),
      ]);
    } catch (emailErr) {
      console.error("Confirmation email failed:", emailErr);
    }

    return respondHtml(200, "Booking Confirmed", `
      <h1 class="success">Booking Confirmed!</h1>
      <p>Your pottery workshop session has been confirmed for:</p>
      <p><strong>${escHtml(fmtDate(booking.suggested_date))}</strong> at <strong>${escHtml(booking.suggested_time_slot)}</strong></p>
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
      ExpressionAttributeValues: { ":status": "DECLINED" },
    })
  );

  try {
    await Promise.all([
      sendClientDeclineNotification(booking.email, booking.lang),
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
