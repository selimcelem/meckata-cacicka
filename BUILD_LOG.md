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
- Full multi-step booking flow (PENDING -> CONFIRMED / RESCHEDULED_PENDING / REQUIRES_MANUAL_CONTACT)
- Token-secured email action links with 7-day TTL
- Resend email integration with .ics calendar attachments

### CI/CD
- GitHub Actions workflow: Terraform plan/apply, frontend deploy, Lambda deploy

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
