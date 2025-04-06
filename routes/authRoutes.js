const express = require("express");
const passport = require("passport");
const jwt = require("jsonwebtoken");
const { signup } = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");
const router = express.Router();
const User = require("../models/User");
const mongoose = require("mongoose");
const connectDB = require("../config/db");

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

router.options("/status", (req, res) => {
  res.header("Access-Control-Allow-Origin", "https://mv-live.netlify.app");
  res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
  res.header("Access-Control-Allow-Credentials", "true");
  res.status(204).end();
});

router.get("/status", async (req, res) => {
  try {
    await ensureDbConnected();
    
    // Set CORS headers explicitly for this endpoint
    const origin = req.headers.origin;
    const allowedOrigins = ['https://mv-live.netlify.app', 'http://localhost:5173'];
    
    if (allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    
    console.log("Auth status check: isAuthenticated=", req.isAuthenticated && req.isAuthenticated(), 
                "user=", req.user ? req.user._id || req.user.id : "none", 
                "session=", req.session ? !!req.session.passport : "no session");
    
    // Try session-based authentication first
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
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
      }
    }
    
    // Try JWT token authentication as fallback
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
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
        }
      } catch (tokenError) {
        console.error("Token verification failed:", tokenError.message);
      }
    }
    
    // Try Google ID authentication as last resort
    if (req.headers.authorization && !req.headers.authorization.startsWith('Bearer')) {
      try {
        const googleId = req.headers.authorization;
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
      const googleId = req.user.id || req.user.googleId;
      const name = req.user.displayName || 'User';
      const email = req.user.emails && req.user.emails[0] ? req.user.emails[0].value : 
                   (req.user.email || `${googleId}@placeholder.com`);
      const profilePic = req.user.photos && req.user.photos[0] ? req.user.photos[0].value : 
                        (req.user.profilePic || null);
      
      if (!googleId) {
        console.error("Google Auth Error: No Google ID provided");
        return res.redirect(`${process.env.CLIENT_URL}/login`);
      }

      // First check if user exists by googleId
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

      // Login the user with session
      req.login(existingUser, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.redirect(`${process.env.CLIENT_URL}/login`);
        }
        
        console.log(`User successfully logged in: ${existingUser.email}`);
        
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