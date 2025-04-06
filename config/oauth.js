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
        
        console.log("Google profile data:", JSON.stringify({
          id: profile.id,
          displayName: profile.displayName,
          emails: profile.emails,
          photos: profile.photos
        }, null, 2));
        
        // Check if we have an ID from Google
        if (!profile.id) {
          return done(new Error("No profile ID from Google"), null);
        }
        
        // Safe extracting of profile info with fallbacks
        const googleId = profile.id;
        const name = profile.displayName || 'User';
        const email = profile.emails && profile.emails.length > 0 ? profile.emails[0].value : 
                     `${googleId}@placeholder.com`;
        const profilePic = profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null;
        
        let user = await User.findOne({ googleId });

        if (!user) {
          user = new User({
            googleId,
            name,
            email,
            profilePic,
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
