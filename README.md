# Meckata Cacicka

A bilingual (CZ/EN) website and manual booking system for a Czech pottery workshop, built entirely on AWS serverless infrastructure with Terraform IaC.

## Architecture

```
                        +-------------------+
                        |   CloudFront CDN  |
                        +--------+----------+
                                 |
                    +------------+------------+
                    |                         |
            +-------+-------+       +--------+--------+
            |  S3 (Static)  |       |  API Gateway    |
            |  HTML/CSS/JS  |       |  REST API       |
            +---------------+       +--------+--------+
                                             |
                                    +--------+--------+
                                    |  Lambda (Node20)|
                                    |  Booking Handler|
                                    +--------+--------+
                                             |
                                +------------+------------+
                                |                         |
                        +-------+-------+       +---------+---------+
                        |   DynamoDB    |       |   Resend (Email)  |
                        |   Bookings    |       |   + .ics invites  |
                        +---------------+       +-------------------+
```

| Component      | Service                | Purpose                          |
|----------------|------------------------|----------------------------------|
| Static hosting | S3 + CloudFront + ACM  | Bilingual website (CZ/EN)        |
| API            | API Gateway + Lambda   | Booking flow endpoints           |
| Database       | DynamoDB               | Booking records + token storage  |
| Email          | Resend                 | Transactional emails + .ics      |
| IaC            | Terraform              | All infrastructure as code       |
| CI/CD          | GitHub Actions         | Automated deploy on push to main |

## Features

- **Bilingual website** -- Full Czech/English toggle with persistent language preference
- **Manual booking flow** -- Multi-step confirm/reschedule/decline with email notifications
- **Calendar invites** -- .ics attachments sent on booking confirmation
- **Token-secured actions** -- UUID tokens with 7-day TTL and single-use enforcement
- **Serverless architecture** -- Pay-per-use, scales to zero, ~EUR0/month on free tier
- **Infrastructure as Code** -- 100% Terraform, no ClickOps

## Tech Stack

| Category       | Technology                        |
|----------------|-----------------------------------|
| Cloud          | AWS (eu-central-1)                |
| Hosting        | S3 + CloudFront                   |
| SSL            | ACM (us-east-1 for CloudFront)    |
| Compute        | Lambda (Node.js 20)               |
| API            | API Gateway (REST)                |
| Database       | DynamoDB (PAY_PER_REQUEST)        |
| Email          | Resend                            |
| IaC            | Terraform >= 1.7                  |
| CI/CD          | GitHub Actions                    |
| Frontend       | Vanilla HTML/CSS/JS               |

## API Endpoints

| Method | Path          | Description                              |
|--------|---------------|------------------------------------------|
| GET    | /slots        | Available time slots for a given month   |
| POST   | /booking      | Submit a new booking                     |
| GET    | /action       | Owner accepts or declines a booking      |
| GET    | /reschedule   | Owner reschedule form (HTML)             |
| POST   | /reschedule   | Owner submits new proposed time          |
| GET    | /respond      | Client accepts/declines rescheduled time |

## Booking Flow

1. **Client books** -- picks date/time, submits details. Status: `PENDING`
2. **Owner acts** via email links:
   - **Accept** -- both parties get confirmation + .ics. Status: `CONFIRMED`
   - **Suggest new time** -- client gets proposal with accept/decline links. Status: `RESCHEDULED_PENDING`
   - **Decline** -- client notified, owner gets contact details. Status: `REQUIRES_MANUAL_CONTACT`
3. **Client responds** to reschedule:
   - **Accept** -- both parties get confirmation + .ics. Status: `CONFIRMED`
   - **Decline** -- owner gets contact details for manual follow-up. Status: `REQUIRES_MANUAL_CONTACT`

## Setup & Deployment

### 1. Bootstrap Remote State

```bash
cd bootstrap
terraform init
terraform apply
```

### 2. Deploy Infrastructure

```bash
cp terraform.tfvars.example terraform.tfvars
# Fill in your values
terraform init
terraform plan
terraform apply
```

### 3. Deploy Lambda

```bash
cd lambda/booking
npm install --production
cd ../..
zip -r lambda-booking.zip lambda/booking/
aws lambda update-function-code \
  --function-name meckata-cacicka-booking \
  --zip-file fileb://lambda-booking.zip
```

### 4. Deploy Frontend

```bash
aws s3 sync frontend/public/ s3://meckata-cacicka-site/ \
  --exclude "*.html" --cache-control "max-age=31536000"
aws s3 sync frontend/public/ s3://meckata-cacicka-site/ \
  --exclude "*" --include "*.html" --cache-control "no-cache"
aws cloudfront create-invalidation \
  --distribution-id $CLOUDFRONT_DISTRIBUTION_ID --paths "/*"
```

## Required Environment Variables

| Variable         | Description                    |
|------------------|--------------------------------|
| `aws_region`     | AWS region (eu-central-1)      |
| `project_name`   | Project identifier             |
| `domain_name`    | Website domain                 |
| `owner_email`    | Workshop owner's email         |
| `resend_api_key` | Resend API key for emails      |

## Project Structure

```
meckata-cacicka/
├── .github/workflows/deploy.yml
├── bootstrap/main.tf
├── modules/
│   ├── hosting/main.tf
│   ├── api/main.tf
│   ├── database/main.tf
│   └── notifications/main.tf
├── lambda/booking/
│   ├── index.js
│   ├── email.js
│   ├── ics.js
│   └── package.json
├── frontend/public/
│   ├── index.html
│   ├── galerie.html
│   ├── workshopy.html
│   ├── o-nas.html
│   ├── kontakt.html
│   ├── style.css
│   └── main.js
├── main.tf
├── variables.tf
├── outputs.tf
└── terraform.tfvars.example
```

## Cost

Designed to run at ~EUR0/month using AWS Free Tier and Resend free tier (100 emails/day).

## Developer

**Selim Celem** -- Career switcher from BIM Engineering to Cloud Engineering

- GitHub: [selimcelem](https://github.com/selimcelem)
- LinkedIn: [selimcelem](https://www.linkedin.com/in/selimcelem)
