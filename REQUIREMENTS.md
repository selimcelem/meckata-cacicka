# Requirements -- Meckata Cacicka

## Design

- **Aesthetic**: Playful, earthy, warm -- reflecting the spirit of handmade pottery
- **Language**: Bilingual CZ/EN with toggle, Czech as default
- **Pages**: Home, Gallery, Workshops (with booking), About, Contact
- **Frontend**: Vanilla HTML/CSS/JS, no build tools, no frameworks
- **Responsive**: Mobile-first design with hamburger navigation

## Booking Flow

### Step 1 -- Client Books
- Client selects available date/time slot on Workshops page
- Calendar fetches live availability from `GET /slots` API -- booked slots are greyed out
- Submits name, email, phone, and current UI language
- Booking saved to DynamoDB with status `PENDING` and `lang` field
- Conditional write prevents double-booking (rejects if slot has active status)
- Client receives acknowledgement email: "Booking Request Received" (in client's language)
- Owner receives notification email with ACCEPT / SUGGEST NEW TIME / DECLINE buttons (English)

### Step 2a -- Owner Accepts
- Booking status -> `CONFIRMED`
- Client receives "Booking Confirmed!" email with .ics calendar invite (in client's language)
- Owner receives "Booking Confirmed" email with client details and .ics calendar invite (English)

### Step 2b -- Owner Suggests New Time
- Owner clicks SUGGEST NEW TIME -> interactive calendar picker page (same style as main calendar)
- Owner selects new date + time slot, submits
- Booking status -> `RESCHEDULED_PENDING`
- Client receives "New Time Suggested" email with ACCEPT / DECLINE buttons (in client's language)
- Owner receives "Suggestion Sent" confirmation email (English)

### Step 2b-i -- Client Accepts New Time
- Original booking -> `CANCELLED` (frees original slot)
- New booking created at suggested date/time -> `CONFIRMED`
- Client receives "Booking Confirmed!" email with .ics (in client's language)
- Owner receives "Client Accepted Your Suggested Time" email with client details and .ics (English)

### Step 2b-ii -- Client Declines New Time
- Booking status -> `DECLINED` (frees the slot)
- Client receives "We Will Be in Touch" / "Ozveme se vam" email (in client's language)
- Owner receives "Manual Follow-Up Required" email with client contact details (English)

### Step 2c -- Owner Declines
- Booking status -> `DECLINED` (frees the slot)
- Client receives "We Will Be in Touch" / "Ozveme se vam" email (in client's language)
- Owner receives "Manual Follow-Up Required" email with client contact details (English)

## DynamoDB Statuses

| Status               | Meaning                                    | Slot blocked? |
|----------------------|--------------------------------------------|:---:|
| `PENDING`            | Awaiting owner decision                    | Yes |
| `CONFIRMED`          | Owner accepted                             | Yes |
| `RESCHEDULED_PENDING`| Owner suggested new time, awaiting client  | Yes |
| `DECLINED`           | Owner declined or client rejected reschedule| No |
| `CANCELLED`          | Superseded by a rescheduled booking        | No |

## Email System

- **Provider**: Resend SDK v4 (free tier: 100 emails/day)
- **From address**: `booking@meckatacacicka.cz` (Resend verified domain)
- **Error handling**: `sendEmail()` wrapper checks `{ data, error }` return (SDK v4 does not throw); logs all sends to CloudWatch
- **Attachments**: .ics calendar invites via `Buffer` with `contentType: "text/calendar"`
- **Date format**: All dates in dd/mm/yyyy European format
- **Bilingual**: Client emails sent in `lang` from booking record (cs/en); owner emails always English

### Email Matrix

| Email                        | Recipient | Language    | Attachment | Trigger                    |
|------------------------------|-----------|-------------|:---:|-------------------------------|
| Booking Request Received     | Client    | Client lang | -- | New booking submitted         |
| New Booking Request          | Owner     | English     | -- | New booking submitted         |
| Booking Confirmed!           | Client    | Client lang | .ics | Owner accepts              |
| Booking Confirmed            | Owner     | English     | .ics | Owner accepts              |
| New Time Suggested           | Client    | Client lang | -- | Owner suggests reschedule     |
| Suggestion Sent              | Owner     | English     | -- | Owner suggests reschedule     |
| Booking Confirmed!           | Client    | Client lang | .ics | Client accepts reschedule  |
| Client Accepted Suggested Time| Owner    | English     | .ics | Client accepts reschedule  |
| We Will Be in Touch          | Client    | Client lang | -- | Owner/client declines         |
| Manual Follow-Up Required    | Owner     | English     | -- | Owner/client declines         |

## Token Security

- All email action links use UUID v4 tokens stored in DynamoDB
- Tokens expire after 7 days (`token_expires_at` TTL)
- Single-use: once an action is taken, the token is invalidated by status change
- Owner tokens: looked up via `token-index` GSI
- Customer tokens: looked up via `customer-token-index` GSI

## Availability

- Time slots are day-of-week specific (configurable in Lambda)
- Past dates/slots are greyed out (Prague timezone)
- Only `PENDING`, `CONFIRMED`, `RESCHEDULED_PENDING` block a slot
- `DECLINED` and `CANCELLED` free the slot for new bookings
- Frontend fetches live availability from API on calendar load and month navigation
- After successful booking, calendar re-fetches to reflect the newly taken slot

## DynamoDB Schema

| Field                | Type   | Description                        |
|----------------------|--------|------------------------------------|
| `date` (PK)          | String | YYYY-MM-DD                         |
| `time_slot` (SK)     | String | HH:MM                              |
| `name`               | String | Client name                        |
| `email`              | String | Client email                       |
| `phone`              | String | Client phone                       |
| `lang`               | String | Client language (cs/en)            |
| `status`             | String | PENDING/CONFIRMED/RESCHEDULED_PENDING/DECLINED/CANCELLED |
| `token`              | String | UUID v4 for owner actions          |
| `token_expires_at`   | String | ISO 8601 timestamp (7-day TTL)     |
| `customer_token`     | String | UUID v4 for client responses       |
| `customer_token_expires_at` | String | ISO 8601 timestamp          |
| `suggested_date`     | String | Proposed reschedule date           |
| `suggested_time_slot`| String | Proposed reschedule time           |
| `created_at`         | String | ISO 8601 timestamp                 |
| `month`              | String | YYYY-MM (for GSI)                  |

### Global Secondary Indexes

| Index Name             | Partition Key    | Sort Key  |
|------------------------|------------------|-----------|
| `month-index`          | `month`          | `date`    |
| `token-index`          | `token`          | --        |
| `customer-token-index` | `customer_token` | --        |

## API Endpoints

| Method | Path        | Auth   | Description                      |
|--------|-------------|--------|----------------------------------|
| GET    | /slots      | Public | Query available time slots       |
| POST   | /booking    | Public | Submit new booking               |
| GET    | /action     | Token  | Owner accept/decline             |
| GET    | /reschedule | Token  | Owner reschedule form            |
| POST   | /reschedule | Token  | Owner submit reschedule          |
| GET    | /respond    | Token  | Client respond to reschedule     |

## Infrastructure

| Resource     | Service            | Region       | ID / Domain                     |
|--------------|--------------------|--------------|---------------------------------|
| Static site  | S3 + CloudFront    | eu-central-1 | `E1U43FVXV92PNO` / `meckatacacicka.cz` |
| S3 bucket    | S3                 | eu-central-1 | `meckata-cacicka-site`          |
| SSL cert     | ACM                | us-east-1    | Verified for `meckatacacicka.cz`|
| API          | API Gateway        | eu-central-1 | `amy3wmuiud`                    |
| Compute      | Lambda (Node.js 20)| eu-central-1 | `meckata-cacicka-booking`       |
| Database     | DynamoDB           | eu-central-1 | `meckata-cacicka-bookings`      |
| Email        | Resend             | External     | `booking@meckatacacicka.cz`     |
| TF State     | S3 + DynamoDB      | eu-central-1 | `meckata-cacicka-terraform-state`|

## CI/CD

- **Workflow**: `.github/workflows/deploy.yml`
- **Trigger**: Push to `main` (apply) or PR to `main` (plan only)
- **Jobs**: Terraform (init/fmt/validate/plan/apply) -> Deploy Frontend (S3 sync + CloudFront invalidation) -> Deploy Lambda (package + update function code)
- **Secrets**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `TF_VAR_DOMAIN_NAME`, `TF_VAR_OWNER_EMAIL`, `TF_VAR_RESEND_API_KEY`, `SITE_BUCKET_NAME`, `CLOUDFRONT_DISTRIBUTION_ID`
