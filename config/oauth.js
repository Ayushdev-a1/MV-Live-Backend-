const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");
const mongoose = require("mongoose");
const connectDB = require("./db");
require("dotenv").config();

// Helper function to ensure database is connected
const ensureDbConnected = async () => {
  if (mongoose.connection.readyState !== 1) {
    console.log("MongoDB not connected, connecting now...");
    await connectDB();
  }
  return true;
};

passport.use(
  new GoogleStrategy( 
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || 
        (process.env.NODE_ENV === 'production' 
          ? "https://mv-live-backend.vercel.app/auth/google/callback"
          : "http://localhost:5000/auth/google/callback"),
      proxy: true  // This helps with proxied requests
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Ensure DB is connected before any operations
        await ensureDbConnected();
        
        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          user = new User({
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails[0].value,
            profilePic: profile.photos[0].value, // Storing profile picture
          });
          await user.save();
        }
 
        return done(null, user);
      } catch (err) {
        console.error("Google auth error:", err);
        return done(err, null);
      }
    }
  )
);

// Also ensure DB connection in the deserializeUser function
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    // Ensure DB is connected
    await ensureDbConnected();
    
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    console.error("Deserialize user error:", err);
    done(err, null);
  }
});
