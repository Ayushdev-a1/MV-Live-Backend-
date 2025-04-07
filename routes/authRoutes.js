const express = require("express");
const passport = require("passport");
const jwt = require("jsonwebtoken");
const { signup } = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");
const router = express.Router();
const User = require("../models/User");
const mongoose = require("mongoose");
const connectDB = require("../config/db");

// CORS middleware for all auth routes
router.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = ['https://mv-live.netlify.app', 'http://localhost:5173'];
  
  // Set CORS headers for all requests
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    console.log(`Setting CORS headers for ${req.method} ${req.path} from origin: ${origin}`);
  } else if (origin) {
    console.log(`Rejected CORS for origin: ${origin}`);
  }
  
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.header("Access-Control-Max-Age", "86400"); // 24 hours
    return res.status(204).end();
  }
  
  next();
});

// Helper function to ensure database is connected
const ensureDbConnected = async () => {
  if (mongoose.connection.readyState !== 1) {
    console.log("MongoDB not connected in routes, connecting now...");
    await connectDB();
  }
  return true;
};

router.post("/login", async (req, res) => {
  try {
    await ensureDbConnected();
    
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate JWT token
    const token = jwt.sign({ _id: user._id, name: user.name }, process.env.JWT_SECRET, { expiresIn: "1d" });

    res.json({ token, user: { _id: user._id, name: user.name } });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.get("/status", async (req, res) => {
  try {
    await ensureDbConnected();
    
    // Set CORS headers explicitly for this endpoint
    const origin = req.headers.origin;
    const allowedOrigins = ['https://mv-live.netlify.app', 'http://localhost:5173'];
    
    // Always check origin and set CORS headers
    if (allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    
    console.log("Auth status check request:", {
      origin: origin,
      method: req.method,
      headers: {
        authorization: req.headers.authorization ? "Present" : "Missing",
        cookie: req.headers.cookie ? "Present" : "Missing"
      },
      isAuthenticated: req.isAuthenticated && req.isAuthenticated(),
      hasUser: !!req.user,
      sessionID: req.sessionID
    });
    
    console.log("Auth status check: isAuthenticated=", req.isAuthenticated && req.isAuthenticated(), 
                "user=", req.user ? req.user._id || req.user.id : "none", 
                "session=", req.session ? !!req.session.passport : "no session",
                "sessionID=", req.sessionID);
    
    // Check session data in more detail
    if (req.session) {
      console.log("Session exists, contents:", JSON.stringify({
        cookie: req.session.cookie ? { 
          maxAge: req.session.cookie.maxAge,
          expires: req.session.cookie.expires,
          secure: req.session.cookie.secure,
          httpOnly: req.session.cookie.httpOnly,
        } : "no cookie",
        passport: req.session.passport || "no passport data"
      }, null, 2));
    }
    
    // Try session-based authentication first
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      // Log details about the authenticated user
      console.log("User authenticated via session:", JSON.stringify({
        id: req.user.id || req.user._id,
        googleId: req.user.googleId,
        email: req.user.email
      }));
      
      // Ensure we have the full user object
      const userId = req.user._id || req.user.id;
      const googleId = req.user.googleId;
      let user;
      
      if (googleId) {
        user = await User.findOne({ googleId });
      } else if (userId) {
        user = await User.findById(userId);
      }
      
      if (user) {
        console.log("Auth status: User authenticated via session", user.email);
        return res.json({
          authenticated: true,
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            profilePic: user.profilePic,
            googleId: user.googleId
          }
        });
      } else {
        console.log("Session user not found in database");
      }
    }
    
    // Try JWT token authentication as fallback
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        console.log("Trying JWT authentication with token:", token.substring(0, 10) + "...");
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log("JWT verified, decoded payload:", JSON.stringify(decoded));
        
        const user = await User.findById(decoded._id || decoded.userId);
        
        if (user) {
          console.log("Auth status: User authenticated via JWT", user.email);
          return res.json({
            authenticated: true,
            user: {
              _id: user._id,
              name: user.name,
              email: user.email,
              profilePic: user.profilePic,
              googleId: user.googleId
            }
          });
        } else {
          console.log("JWT user not found in database");
        }
      } catch (tokenError) {
        console.error("Token verification failed:", tokenError.message);
      }
    }
    
    // Try Google ID authentication as last resort
    if (req.headers.authorization && !req.headers.authorization.startsWith('Bearer')) {
      try {
        const googleId = req.headers.authorization;
        console.log("Trying Google ID authentication with ID:", googleId);
        
        const user = await User.findOne({ googleId });
        
        if (user) {
          console.log("Auth status: User authenticated via Google ID", user.email);
          return res.json({
            authenticated: true,
            user: {
              _id: user._id,
              name: user.name,
              email: user.email,
              profilePic: user.profilePic,
              googleId: user.googleId
            }
          });
        } else {
          console.log("Google ID user not found in database");
        }
      } catch (googleIdError) {
        console.error("Google ID lookup failed:", googleIdError.message);
      }
    }
    
    // If no authentication method worked
    console.log("Auth status: Not authenticated");
    res.json({ authenticated: false });
  } catch (error) {
    console.error("Auth status error:", error);
    res.json({ authenticated: false, error: error.message });
  }
});

// Google Authentication
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: `${process.env.CLIENT_URL}/login` }),
  async (req, res) => {
    try {
      await ensureDbConnected();
      
      if (!req.user) {
        console.error("Google Auth Error: No user data");
        return res.redirect(`${process.env.CLIENT_URL}/login`);
      }

      console.log("Google auth user data:", JSON.stringify(req.user, null, 2));
      
      // Extract profile data safely with fallbacks
      const googleId = req.user.googleId || req.user.id;
      const name = req.user.name || req.user.displayName || 'User';
      const email = req.user.email || (req.user.emails && req.user.emails[0] ? req.user.emails[0].value : `${googleId}@placeholder.com`);
      const profilePic = req.user.profilePic || (req.user.photos && req.user.photos[0] ? req.user.photos[0].value : null);
      
      if (!googleId) {
        console.error("Google Auth Error: No Google ID provided");
        return res.redirect(`${process.env.CLIENT_URL}/login`);
      }

      // Ensure the user exists in the database
      let existingUser = await User.findOne({ googleId });

      // If no user found by googleId, check by email
      if (!existingUser && email) {
        existingUser = await User.findOne({ email });
        
        // If user exists by email but doesn't have googleId, update the user
        if (existingUser && !existingUser.googleId) {
          existingUser.googleId = googleId;
          existingUser.profilePic = profilePic || existingUser.profilePic;
          await existingUser.save();
          console.log(`Updated existing user (${existingUser.email}) with Google ID`);
        }
      }

      // If still no user, create a new one
      if (!existingUser) {
        try {
          existingUser = await User.create({
            googleId,
            name,
            email,
            profilePic,
          });
          console.log(`Created new user with Google ID: ${googleId}`);
        } catch (createError) {
          if (createError.code === 11000) {
            // Handle duplicate key error differently
            console.error(`Duplicate key error: ${JSON.stringify(createError)}`);
            
            // Try to find the user one more time
            existingUser = await User.findOne({ email });
            
            if (!existingUser) {
              return res.redirect(`${process.env.CLIENT_URL}/login?error=duplicate_email`);
            }
            
            // Update the existing user with Google ID if not set
            if (!existingUser.googleId) {
              existingUser.googleId = googleId;
              existingUser.profilePic = profilePic || existingUser.profilePic;
              await existingUser.save();
              console.log(`Updated existing user after duplicate error: ${email}`);
            }
          } else {
            throw createError; // Re-throw other errors
          }
        }
      }

      // Generate JWT token as a backup authentication method
      const token = jwt.sign(
        { _id: existingUser._id, name: existingUser.name }, 
        process.env.JWT_SECRET, 
        { expiresIn: "7d" }
      );

      // Make sure the user is properly attached to the request
      req.user = existingUser;

      // Login the user with session - force a proper session creation
      req.login(existingUser, { session: true }, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.redirect(`${process.env.CLIENT_URL}/login`);
        }
        
        console.log(`User successfully logged in: ${existingUser.email}`);
        
        // Force the session to be saved explicitly
        req.session.passport = { user: existingUser._id };
        
        // Set session cookie explicitly to help with persistence
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
          }
          
          // Redirect to landing page with token and Google ID in query params
          // The frontend can use these as fallback authentication methods
          res.redirect(`${process.env.CLIENT_URL}/landing?token=${token}&googleId=${googleId}`);
        });
      });
    } catch (error) {
      console.error("Google login error:", error);
      res.redirect(`${process.env.CLIENT_URL}/login?error=${error.message}`);
    }
  }
);

// Logout route
router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    res.redirect(`${process.env.CLIENT_URL}/login`);
  });
});

// Protected route
router.get("/protected", protect, (req, res) => {
  res.json({ message: "Access Granted", user: req.user });
});

module.exports = router; 