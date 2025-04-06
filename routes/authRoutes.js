const express = require("express");
const passport = require("passport");
const jwt = require("jsonwebtoken");
const { signup } = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");
const router = express.Router();
const User = require("../models/User");

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user || !(await user.matchPassword(password))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  // Generate JWT token
  const token = jwt.sign({ _id: user._id, name: user.name }, process.env.JWT_SECRET, { expiresIn: "1d" });

  res.json({ token, user: { _id: user._id, name: user.name } });
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
      if (!req.user) {
        console.error("Google Auth Error: No user data");
        return res.redirect(`${process.env.CLIENT_URL}/login`);
      }

      let existingUser = await User.findOne({ googleId: req.user.id });

      if (!existingUser) {
        existingUser = await User.create({
          googleId: req.user.id,
          name: req.user.displayName,
          email: req.user.emails[0].value,
          profilePic: req.user.photos[0].value,
        });
      }

      req.login(existingUser, (err) => {
        if (err) {
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