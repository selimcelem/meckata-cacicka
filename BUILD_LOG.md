# Build Log -- Meckata Cacicka

## Phase 1 -- Project Setup (2026-04-06)

### Repository & Scaffolding
- Created GitHub repository `selimcelem/meckata-cacicka`
- Scaffolded full project structure mirroring q-atelier conventions
- Created all Terraform modules, Lambda handler, and frontend skeleton

### Infrastructure
- Bootstrap: S3 state bucket + DynamoDB lock table
- Root module: hosting, api, database, notifications
- Dual AWS provider setup (eu-central-1 + us-east-1 for ACM)

### Frontend
- Bilingual CZ/EN with language toggle and localStorage persistence
- Playful earthy design with warm color palette
- Booking calendar with time slot picker on Workshops page

### Lambda Booking Handler
- Multi-step booking flow with token-secured email action links
- Resend email integration with .ics calendar attachments

### CI/CD
- GitHub Actions workflow: Terraform plan/apply, frontend deploy, Lambda deploy

---

## Phase 2 -- Deployment & Bug Fixes (2026-04-07)

### Infrastructure Deployment
- Ran `terraform apply` -- created all 12 AWS resources:
  - CloudFront distribution (`E1U43FVXV92PNO`)
  - S3 bucket policy for OAC
  - Lambda function (`meckata-cacicka-booking`, 256MB, Node.js 20)
  - API Gateway: 6 integrations, deployment, prod stage
  - Lambda invoke permission
- Deployed frontend to S3 bucket `meckata-cacicka-site`
- Invalidated CloudFront cache
- Site live at `meckatacacicka.cz`

### CI/CD Pipeline Fix
- Removed hardcoded `profile = "meckata-cacicka"` from Terraform backend and provider blocks
- CI uses AWS env vars, not named profiles -- first pipeline run failed on `terraform init`
- Second run: all 3 jobs passed (Terraform, Deploy Frontend, Deploy Lambda)

### Bug Fix: Form Submission & Success Message
- `#booking-message` div was inside `#booking-form-container` which gets hidden after success -- looked like page navigated away
- Moved `#booking-message` outside form container so it stays visible
- Added 5-second auto-dismiss on success message via `setTimeout`
- Removed HTML `required` attributes to prevent native validation competing with JS validation

### Bug Fix: Frontend Payload Field Name
- Frontend sent `time` but Lambda expected `time_slot` -- every booking returned 400
- Fixed payload: `time` -> `time_slot`, removed unused `timezone` field

### Bug Fix: API Endpoint Missing
- `window.API_ENDPOINT` was empty string -- frontend fetched `/booking` from CloudFront (static site) instead of API Gateway
- Lambda was never invoked from the frontend; all bookings silently failed
- Set `API_ENDPOINT` to `https://amy3wmuiud.execute-api.eu-central-1.amazonaws.com/prod`

### Bug Fix: Resend SDK v4 Error Handling
- Resend SDK v4 returns `{ data, error }` instead of throwing -- all email errors were silently swallowed by try/catch
- Added `sendEmail()` wrapper that checks return value and throws on errors
- All 8+ email functions now use the wrapper
- Added logging: every email send logs recipient, subject, and Resend email ID (or error) to CloudWatch

### Bug Fix: Action Links Routing
- `API_DOMAIN` was set to CloudFront domain (`d2aekbq3tdbplh.cloudfront.net`)
- Action links (accept/decline/suggest) hit CloudFront, got 404 -> `/index.html` redirect
- Fixed: `API_DOMAIN` now computed from API Gateway rest API ID + region inside the api module
- Removed `api_domain` variable from module interface (eliminated circular dependency risk)

### Bug Fix: Client Acknowledgement Email
- `handlePostBooking` called `sendBookingConfirmation` ("Booking Confirmed!") for PENDING bookings -- wrong message
- Created `sendBookingAcknowledgement` function: "Booking Request Received" with correct PENDING-appropriate copy
- Renamed `email` variable to `clientEmail` in handler for clarity

### Bug Fix: Double Booking Error Display
- DynamoDB `ConditionExpression` correctly rejected duplicates (409), but frontend read `data.message` while Lambda returned `{ error: "..." }`
- Frontend now checks `response.status === 409` specifically with bilingual error message
- Also reads `data.error` as fallback for other error responses

### Bug Fix: .ics Calendar Attachment
- Resend SDK v4 attachment format: `content_type` -> `contentType` (camelCase), `Buffer.toString("base64")` -> raw `Buffer`
- Attachments were silently dropped from all confirmation emails
- Fixed in `sendBookingConfirmation` -- now works for both accept and reschedule accept flows
- Added .ics attachments to owner confirmation emails (`sendBookingAcceptedNotification`, `sendRescheduleAcceptedNotification`)

### Feature: Live Slot Availability
- Frontend now fetches `GET /slots?month=YYYY-MM` from the API on calendar load and month navigation
- Only dates with available slots are clickable; booked slots are greyed out
- After successful booking, availability is re-fetched so the just-booked slot disappears immediately
- Results cached per month to avoid redundant API calls

### Feature: Declined Booking Slot Recovery
- `GET /slots` now only considers `PENDING`, `CONFIRMED`, `RESCHEDULED_PENDING` as "taken"
- `DECLINED` and `CANCELLED` bookings free the slot for new bookings
- `isSlotTaken()` uses same `ACTIVE_STATUSES` set for consistency
- Conditional writes allow overwriting any non-active status
- Owner decline action sets status to `DECLINED` (was `REQUIRES_MANUAL_CONTACT`)

### Feature: Owner vs Client Email Separation
- Owner accept: sends `sendBookingAcceptedNotification` (owner-specific, shows client details) instead of `sendBookingConfirmation`
- Reschedule accept: sends `sendRescheduleAcceptedNotification` to owner, `sendBookingConfirmation` to client
- Both owner confirmation emails include .ics calendar attachment

### Feature: Reschedule Calendar Picker
- Replaced plain text date input on "Suggest New Time" page with interactive calendar picker
- Same visual style as main booking calendar: terracotta colors, day grid, time slot buttons
- No manual text entry -- fully click-based date and time selection

### Feature: European Date Format
- All dates in emails display as dd/mm/yyyy (was yyyy-mm-dd)
- Added `fmtDate()` helper to both `email.js` and `index.js`
- Applied to all email subjects, email bodies, and Lambda-rendered HTML pages

### Feature: Bilingual Email System
- Frontend sends `lang` ("cs" or "en") in booking payload based on selected language
- Lambda stores `lang` on DynamoDB booking record
- 4 client-facing emails are fully bilingual (Czech/English):
  - Booking acknowledgement
  - Booking confirmation (with .ics)
  - Reschedule proposal (with PŘIJMOUT/ODMÍTNOUT buttons)
  - Decline notification
- 5 owner-facing emails remain in English:
  - New booking notification
  - Booking accepted confirmation
  - Suggestion sent confirmation
  - Reschedule accepted notification
  - Manual follow-up required

---

## Architecture Decisions

| Decision                    | Rationale                                           |
|-----------------------------|-----------------------------------------------------|
| Vanilla HTML/CSS/JS         | No build step, instant deploy, portfolio simplicity |
| Resend over SES             | Simpler setup, free tier sufficient, better DX      |
| DynamoDB PAY_PER_REQUEST    | Zero cost at low volume, no capacity planning       |
| Single Lambda handler       | Reduces cold starts, simpler deployment             |
| CloudFront OAC (not OAI)   | Modern best practice, OAI is legacy                 |
| customer-token-index GSI    | O(1) lookup for customer responses (vs Scan)        |
| Bilingual with JS toggle    | No server-side rendering needed, SEO acceptable     |
| API_DOMAIN from API GW ID   | Avoids circular dependency, works in CI without profile |
| ACTIVE_STATUSES set         | Single source of truth for slot-blocking logic      |
| sendEmail wrapper            | Catches Resend SDK v4 silent errors, adds logging   |
