variable "project_name" {
  type = string
}

variable "owner_email" {
  type      = string
  sensitive = true
}

variable "resend_api_key" {
  type      = string
  sensitive = true
}

variable "bookings_table_name" {
  type = string
}

variable "bookings_table_arn" {
  type = string
}

# --- IAM Role ---

resource "aws_iam_role" "lambda" {
  name = "${var.project_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${var.project_name}-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          var.bookings_table_arn,
          "${var.bookings_table_arn}/index/*"
        ]
      }
    ]
  })
}

data "aws_region" "current" {}

# --- Lambda Function ---

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.root}/lambda/booking"
  output_path = "${path.root}/lambda-booking.zip"
  excludes    = ["node_modules/.package-lock.json"]
}

resource "aws_lambda_function" "booking" {
  function_name    = "${var.project_name}-booking"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 15
  memory_size      = 256
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  environment {
    variables = {
      TABLE_NAME     = var.bookings_table_name
      OWNER_EMAIL    = var.owner_email
      RESEND_API_KEY = var.resend_api_key
      API_DOMAIN     = "${aws_api_gateway_rest_api.api.id}.execute-api.${data.aws_region.current.name}.amazonaws.com"
    }
  }
}

# --- API Gateway ---

resource "aws_api_gateway_rest_api" "api" {
  name        = "${var.project_name}-api"
  description = "Meckata Cacicka booking API"
}

# /slots
resource "aws_api_gateway_resource" "slots" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "slots"
}

resource "aws_api_gateway_method" "slots_get" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.slots.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "slots_get" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.slots.id
  http_method             = aws_api_gateway_method.slots_get.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.booking.invoke_arn
}

# /booking
resource "aws_api_gateway_resource" "booking" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "booking"
}

resource "aws_api_gateway_method" "booking_post" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.booking.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "booking_post" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.booking.id
  http_method             = aws_api_gateway_method.booking_post.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.booking.invoke_arn
}

# /booking OPTIONS (CORS)
resource "aws_api_gateway_method" "booking_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.booking.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "booking_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.booking.id
  http_method = aws_api_gateway_method.booking_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "booking_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.booking.id
  http_method = aws_api_gateway_method.booking_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "booking_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.booking.id
  http_method = aws_api_gateway_method.booking_options.http_method
  status_code = aws_api_gateway_method_response.booking_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# /action
resource "aws_api_gateway_resource" "action" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "action"
}

resource "aws_api_gateway_method" "action_get" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.action.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "action_get" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.action.id
  http_method             = aws_api_gateway_method.action_get.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.booking.invoke_arn
}

# /reschedule
resource "aws_api_gateway_resource" "reschedule" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "reschedule"
}

resource "aws_api_gateway_method" "reschedule_get" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.reschedule.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "reschedule_get" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.reschedule.id
  http_method             = aws_api_gateway_method.reschedule_get.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.booking.invoke_arn
}

resource "aws_api_gateway_method" "reschedule_post" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.reschedule.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "reschedule_post" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.reschedule.id
  http_method             = aws_api_gateway_method.reschedule_post.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.booking.invoke_arn
}

# /reschedule OPTIONS (CORS)
resource "aws_api_gateway_method" "reschedule_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.reschedule.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "reschedule_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.reschedule.id
  http_method = aws_api_gateway_method.reschedule_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "reschedule_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.reschedule.id
  http_method = aws_api_gateway_method.reschedule_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "reschedule_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.reschedule.id
  http_method = aws_api_gateway_method.reschedule_options.http_method
  status_code = aws_api_gateway_method_response.reschedule_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# /respond
resource "aws_api_gateway_resource" "respond" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "respond"
}

resource "aws_api_gateway_method" "respond_get" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.respond.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "respond_get" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.respond.id
  http_method             = aws_api_gateway_method.respond_get.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.booking.invoke_arn
}

# --- Deployment ---

resource "aws_api_gateway_deployment" "api" {
  rest_api_id = aws_api_gateway_rest_api.api.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.slots.id,
      aws_api_gateway_resource.booking.id,
      aws_api_gateway_resource.action.id,
      aws_api_gateway_resource.reschedule.id,
      aws_api_gateway_resource.respond.id,
      aws_api_gateway_method.slots_get.id,
      aws_api_gateway_method.booking_post.id,
      aws_api_gateway_method.action_get.id,
      aws_api_gateway_method.reschedule_get.id,
      aws_api_gateway_method.reschedule_post.id,
      aws_api_gateway_method.respond_get.id,
      aws_api_gateway_integration.slots_get.id,
      aws_api_gateway_integration.booking_post.id,
      aws_api_gateway_integration.action_get.id,
      aws_api_gateway_integration.reschedule_get.id,
      aws_api_gateway_integration.reschedule_post.id,
      aws_api_gateway_integration.respond_get.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.api.id
  rest_api_id   = aws_api_gateway_rest_api.api.id
  stage_name    = "prod"
}

# --- Lambda Permission ---

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.booking.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

# --- Outputs ---

output "api_endpoint" {
  value = aws_api_gateway_stage.prod.invoke_url
}

output "lambda_function_name" {
  value = aws_lambda_function.booking.function_name
}
