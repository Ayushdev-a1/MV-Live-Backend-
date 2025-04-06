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
    res.header("Access-Control-Allow-Origin", "https://mv-live.netlify.app");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    
    if (req.isAuthenticated() && req.user) {
      const user = await User.findOne({ googleId: req.user.googleId });
      if (!user) {
        return res.json({ authenticated: false });
      }

      res.json({
        authenticated: true,
        user,
      });
    } else {
      res.json({ authenticated: false });
    }
  } catch (error) {
    console.error("Auth status error:", error);
    res.json({ authenticated: false });
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

      let existingUser = await User.findOne({ googleId });

      if (!existingUser) {
        existingUser = await User.create({
          googleId,
          name,
          email,
          profilePic,
        });
      }

      req.login(existingUser, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.redirect(`${process.env.CLIENT_URL}/login`);
        }
        res.redirect(`${process.env.CLIENT_URL}/landing`);
      });
    } catch (error) {
      console.error("Google login error:", error);
      res.redirect(`${process.env.CLIENT_URL}/login`);
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