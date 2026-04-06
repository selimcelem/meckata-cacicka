output "cloudfront_domain" {
  value       = module.hosting.cloudfront_domain
  description = "CloudFront distribution domain name"
}

output "s3_bucket_name" {
  value       = module.hosting.s3_bucket_name
  description = "S3 bucket name for frontend deployment"
}

output "api_endpoint" {
  value       = module.api.api_endpoint
  description = "API Gateway endpoint URL"
}

output "cloudfront_distribution_id" {
  value       = module.hosting.cloudfront_distribution_id
  description = "CloudFront distribution ID for cache invalidation"
}
