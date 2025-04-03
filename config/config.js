module.exports = {
  jwtSecret: process.env.JWT_SECRET || "your_jwt_secret",
  jwtExpiration: "24h",
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/movie-stream",
  port: process.env.PORT || 5000,
  corsOrigin: process.env.CORS_ORIGIN || "*",
}

