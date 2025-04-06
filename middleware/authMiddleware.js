const User = require("../models/User");
const jwt = require('jsonwebtoken');

exports.protect = async (req, res, next) => {
  let token;
  
  // Check if using session-based auth
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    // User is authenticated via passport session
    try {
      const user = await User.findOne({ googleId: req.user.googleId || req.user.id });
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "User no longer exists",
        });
      }
      
      req.user = user; // Use the full user object from database
      return next();
    } catch (error) {
      console.error("Session auth error:", error);
      return res.status(401).json({
        success: false,
        message: "Authentication error",
      });
    }
  }
  
  // Check for JWT token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];
      
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from the token
      const user = await User.findById(decoded._id).select('-password');
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "User no longer exists",
        });
      }
      
      req.user = user;
      return next();
    } catch (error) {
      console.error("JWT auth error:", error);
      return res.status(401).json({
        success: false,
        message: "Not authorized, token failed",
      });
    }
  }
  
  // Fallback to check for googleId directly in header (legacy support)
  const googleId = req.headers.authorization;
  if (googleId) {
    try {
      // Check if user exists with the provided Google ID
      const user = await User.findOne({ googleId });

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "User no longer exists",
        });
      }

      req.user = user; // Use the full user object from database
      return next();
    } catch (error) {
      console.error("GoogleID auth error:", error);
      return res.status(401).json({
        success: false,
        message: "Authentication error",
      });
    }
  }
  
  // No authentication method worked
  return res.status(401).json({
    success: false,
    message: "Not authorized, no token or session",
  });
};