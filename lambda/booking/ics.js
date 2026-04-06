"use strict";

/**
 * Generates an iCalendar (.ics) file for a pottery workshop booking.
 *
 * @param {string} date       - ISO date string, e.g. "2026-05-14"
 * @param {string} timeSlot   - Time in "HH:MM" format, e.g. "17:00"
 * @param {string} clientName - Full name of the client
 * @param {string} clientEmail - Email address of the client
 * @returns {string} iCalendar formatted string
 */
function generateIcs(date, timeSlot, clientName, clientEmail) {
  const [hours, minutes] = timeSlot.split(":").map(Number);

  // Build start date-time in Europe/Prague local time (TZID reference)
  const year = date.slice(0, 4);
  const month = date.slice(5, 7);
  const day = date.slice(8, 10);

  const startLocal = `${year}${month}${day}T${pad(hours)}${pad(minutes)}00`;

  // Duration is 90 minutes
  let endHours = hours + 1;
  let endMinutes = minutes + 30;
  if (endMinutes >= 60) {
    endHours += 1;
    endMinutes -= 60;
  }
  const endLocal = `${year}${month}${day}T${pad(endHours)}${pad(endMinutes)}00`;

  const uid = `${date}-${timeSlot.replace(":", "")}-${Date.now()}@meckatacacicka.cz`;
  const nowUtc = formatUtcNow();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Meckata Cacicka//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "",
    // VTIMEZONE for Europe/Prague (CET/CEST)
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Prague",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    "",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART;TZID=Europe/Prague:${startLocal}`,
    `DTEND;TZID=Europe/Prague:${endLocal}`,
    `SUMMARY:Pottery Workshop - Meckata Cacicka`,
    `DESCRIPTION:Pottery workshop session for ${escapeIcsText(clientName)}.`,
    `LOCATION:Meckata Cacicka pottery workshop`,
    `ORGANIZER;CN=Meckata Cacicka:mailto:booking@meckatacacicka.cz`,
    `ATTENDEE;CN=${escapeIcsText(clientName)};RSVP=TRUE:mailto:${clientEmail}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatUtcNow() {
  const d = new Date();
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeIcsText(text) {
  return text.replace(/[\\;,]/g, (ch) => "\\" + ch).replace(/\n/g, "\\n");
}

module.exports = { generateIcs };
