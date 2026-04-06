variable "project_name" {
  type = string
}

resource "aws_dynamodb_table" "bookings" {
  name         = "${var.project_name}-bookings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "date"
  range_key    = "time_slot"

  attribute {
    name = "date"
    type = "S"
  }

  attribute {
    name = "time_slot"
    type = "S"
  }

  attribute {
    name = "month"
    type = "S"
  }

  attribute {
    name = "token"
    type = "S"
  }

  attribute {
    name = "customer_token"
    type = "S"
  }

  global_secondary_index {
    name            = "month-index"
    hash_key        = "month"
    range_key       = "date"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "token-index"
    hash_key        = "token"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "customer-token-index"
    hash_key        = "customer_token"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}

output "bookings_table_name" {
  value = aws_dynamodb_table.bookings.name
}

output "bookings_table_arn" {
  value = aws_dynamodb_table.bookings.arn
}
