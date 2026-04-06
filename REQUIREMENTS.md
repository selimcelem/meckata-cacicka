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
- Submits name, email, phone
- Booking saved to DynamoDB with status `PENDING`
- Owner (Terka) receives email with 3 action links: ACCEPT, SUGGEST NEW TIME, DECLINE

### Step 2a -- Owner Accepts
- Client receives confirmation email with date/time + .ics calendar invite
- Owner receives confirmation email with date/time + .ics calendar invite
- Booking status -> `CONFIRMED`

### Step 2b -- Owner Suggests New Time
- Owner directed to a page to pick new date/time
- Client receives email with proposed time + ACCEPT / DECLINE links
- Owner receives email confirming suggestion was sent
- Booking status -> `RESCHEDULED_PENDING`

### Step 2b-i -- Client Accepts New Time
- Both receive confirmation emails + .ics
- Booking status -> `CONFIRMED`

### Step 2b-ii -- Client Declines New Time
- Client receives email saying workshop will contact them directly
- Owner receives email with client's full contact details
- Booking status -> `REQUIRES_MANUAL_CONTACT`

### Step 2c -- Owner Declines
- Client receives email saying workshop will contact them directly
- Owner receives email with client's full contact details
- Booking status -> `REQUIRES_MANUAL_CONTACT`

## Email System

- **Provider**: Resend (free tier: 100 emails/day)
- **Types**: Plain text notifications, HTML action emails, .ics calendar attachments
- **From address**: Configured via Resend verified domain

## Token Security

- All email action links use UUID v4 tokens stored in DynamoDB
- Tokens expire after 7 days (`token_expires_at` TTL)
- Single-use: once an action is taken, the token is invalidated by status change
- Owner tokens: looked up via `token-index` GSI
- Customer tokens: looked up via `customer-token-index` GSI

## Availability

- Time slots are day-of-week specific (configurable in Lambda)
- Past dates/slots are greyed out
- Slots with existing non-cancelled bookings are unavailable

## DynamoDB Schema

| Field                | Type   | Description                        |
|----------------------|--------|------------------------------------|
| `date` (PK)          | String | YYYY-MM-DD                         |
| `time_slot` (SK)     | String | HH:MM                              |
| `name`               | String | Client name                        |
| `email`              | String | Client email                       |
| `phone`              | String | Client phone                       |
| `status`             | String | PENDING/CONFIRMED/RESCHEDULED_PENDING/REQUIRES_MANUAL_CONTACT/CANCELLED |
| `token`              | String | UUID v4 for owner actions          |
| `token_expires_at`   | Number | Unix timestamp (TTL)               |
| `customer_token`     | String | UUID v4 for client responses       |
| `suggested_date`     | String | Proposed reschedule date            |
| `suggested_time_slot`| String | Proposed reschedule time            |
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

| Resource     | Service            | Region       |
|--------------|--------------------|--------------|
| Static site  | S3 + CloudFront    | eu-central-1 |
| SSL cert     | ACM                | us-east-1    |
| API          | API Gateway        | eu-central-1 |
| Compute      | Lambda (Node.js 20)| eu-central-1 |
| Database     | DynamoDB           | eu-central-1 |
| Email        | Resend             | External     |
| State        | S3 + DynamoDB      | eu-central-1 |
