const express = require("express");
const passport = require("passport");
const jwt = require("jsonwebtoken");
const { signup } = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");
const User = require("../models/User");

const router = express.Router();
const CLIENT_URL = process.env.CLIENT_URL;

router.post("/signup", signup);

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

router.get("/status", async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', 'https://mv-live.netlify.app')
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
  passport.authenticate("google", { failureRedirect: `${CLIENT_URL}/login` }),
  async (req, res) => {
    try {
      if (!req.user) {
        console.error("Google Auth Error:", err || info);
        return res.redirect(`${CLIENT_URL}/login`);
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
          return res.redirect(`${CLIENT_URL}/login`);
        }
        res.redirect(`${CLIENT_URL}/landing`);
      });
    } catch (error) {
      console.error("Google login error:", error);
      res.redirect(`${CLIENT_URL}/login`);
    }
  }
);

// Logout route
router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    res.redirect(`${CLIENT_URL}/login`);
  });
});

// Protected route
router.get("/protected", protect, (req, res) => {
  res.json({ message: "Access Granted", user: req.user });
});

module.exports = router;
