exports.errorHandler = (err, req, res, next) => {
  console.error("Error:", err)

  // Default error status and message
  let statusCode = err.statusCode || 500
  let message = err.message || "Server Error"

  // Handle Mongoose validation errors
  if (err.name === "ValidationError") {
    statusCode = 400
    const errors = Object.values(err.errors).map((val) => val.message)
    message = errors.join(", ")
  }

  // Handle Mongoose duplicate key errors
  if (err.code === 11000) {
    statusCode = 400
    message = "Duplicate field value entered"
  }

  // Handle JWT errors
  if (err.name === "JsonWebTokenError") {
    statusCode = 401
    message = "Invalid token"
  }

  // Handle JWT expiration
  if (err.name === "TokenExpiredError") {
    statusCode = 401
    message = "Token expired"
  }

  res.status(statusCode).json({
    success: false,
    message,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  })
}

