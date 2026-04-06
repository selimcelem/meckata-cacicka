# Portfolio -- Meckata Cacicka

## About This Project

Meckata Cacicka is a production-grade website and booking system for a Czech pottery workshop. It demonstrates end-to-end cloud engineering: infrastructure as code, serverless compute, transactional email workflows, and automated CI/CD -- all within AWS Free Tier constraints.

The workshop is a real business offering pottery sessions for people seeking a moment of calm after work and wanting to reconnect with their inner child.

## My Role

Sole cloud engineer responsible for:
- Architecture design and technology selection
- Full Terraform infrastructure (S3, CloudFront, ACM, API Gateway, Lambda, DynamoDB)
- Lambda booking handler with multi-step email workflow
- Bilingual frontend (Czech/English)
- CI/CD pipeline with GitHub Actions
- Cost optimization (target: EUR0/month)

## Key Engineering Decisions

### Why Serverless Over EC2/ECS?

A pottery workshop receives maybe 5-10 bookings per week. Running an always-on server would cost EUR15-40/month for zero traffic most of the time. The serverless stack (Lambda + API Gateway + DynamoDB + S3/CloudFront) costs effectively nothing at this scale while handling occasional traffic spikes from social media posts without any capacity planning.

### Why Resend Over AWS SES?

SES requires domain verification, sandbox exit requests, and careful bounce/complaint handling. Resend provides a modern API, generous free tier (100 emails/day -- more than enough), and significantly simpler integration. For a workshop sending maybe 30 emails/week, operational simplicity wins over AWS-native integration.

### Why a Manual Booking Flow?

The workshop owner wants personal control over every booking. An auto-confirm system would remove the human touch that defines the workshop. The accept/reschedule/decline flow lets the owner manage their schedule while the system handles all the email logistics automatically.

### Why Vanilla HTML/CSS/JS?

No build tools means no Node.js version issues, no webpack configs, no dependency vulnerabilities. The site deploys as static files to S3 with a simple `aws s3 sync`. For a 5-page workshop site, React or Next.js would add complexity with zero benefit.

### Why Bilingual With Client-Side Toggle?

The workshop serves both Czech locals and expat communities in Prague. A JavaScript language toggle with localStorage persistence provides seamless switching without server-side rendering, duplicate pages, or URL path complexity.

## Challenges & Solutions

### Token Security for Email Actions
Email action links need to be secure but usable. I implemented UUID v4 tokens stored in DynamoDB with 7-day TTL and single-use enforcement. Each action (accept, decline, reschedule) invalidates the token by changing the booking status, preventing replay attacks.

### Dual-Region Terraform
CloudFront requires ACM certificates in us-east-1, but all other resources live in eu-central-1. I used Terraform provider aliases to manage resources across both regions in a single state file, keeping the infrastructure definition cohesive.

### Cost-Zero Architecture
Every component was chosen to stay within AWS Free Tier: S3 (5GB), CloudFront (1TB/month), Lambda (1M requests), DynamoDB (25GB + 25 RCU/WCU), plus Resend's free tier for email. The result is a production-grade system that costs nothing to operate at workshop scale.

## What I Learned

- Terraform module composition and provider aliasing across regions
- CloudFront Origin Access Control (OAC) configuration for private S3 buckets
- DynamoDB single-table design with GSIs for multiple access patterns
- Token-based email action workflows with expiry and single-use enforcement
- .ics calendar invite generation and email attachment handling
- GitHub Actions CI/CD with Terraform plan/apply automation
- Bilingual frontend architecture without frameworks or build tools

## Live Site

- Website: [meckatacacicka.cz](https://meckatacacicka.cz) *(deployment pending DNS configuration)*
- Repository: [github.com/selimcelem/meckata-cacicka](https://github.com/selimcelem/meckata-cacicka)
