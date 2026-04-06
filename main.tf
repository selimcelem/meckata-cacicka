terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "meckata-cacicka-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "meckata-cacicka-terraform-lock"
    encrypt        = true
    profile        = "meckata-cacicka"
  }
}

provider "aws" {
  region  = var.aws_region
  profile = "meckata-cacicka"
}

provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = "meckata-cacicka"
}

module "hosting" {
  source = "./modules/hosting"

  project_name = var.project_name
  domain_name  = var.domain_name

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

module "database" {
  source = "./modules/database"

  project_name = var.project_name
}

module "notifications" {
  source = "./modules/notifications"

  project_name = var.project_name
  owner_email  = var.owner_email
}

module "api" {
  source = "./modules/api"

  project_name        = var.project_name
  owner_email         = var.owner_email
  resend_api_key      = var.resend_api_key
  bookings_table_name = module.database.bookings_table_name
  bookings_table_arn  = module.database.bookings_table_arn
  api_domain          = module.hosting.cloudfront_domain
}
