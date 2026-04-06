variable "project_name" {
  type = string
}

variable "owner_email" {
  type      = string
  sensitive = true
}

# Email is handled by Resend (external service).
# This module is a placeholder for any future AWS-native
# notification resources (SNS, SES, etc.).
