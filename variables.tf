variable "aws_region" {
  type        = string
  description = "AWS region for all resources"
  default     = "eu-central-1"
}

variable "project_name" {
  type        = string
  description = "Project name used for resource naming"
  default     = "meckata-cacicka"
}

variable "domain_name" {
  type        = string
  description = "Domain name for the website"
}

variable "owner_email" {
  type        = string
  description = "Workshop owner email address"
  sensitive   = true
}

variable "resend_api_key" {
  type        = string
  description = "Resend API key for sending emails"
  sensitive   = true
}
