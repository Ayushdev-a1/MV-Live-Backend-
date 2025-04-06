const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  googleId: { 
    type: String, 
    sparse: true, // Allow null for non-Google users
    index: true   // Index for faster lookups
  },
  name: { 
    type: String, 
    required: true 
  },
  email: { 
    type: String, 
    index: true,  // Index for faster lookups
    unique: true, 
    required: function() { 
      // Only require email for non-Google auth users
      return !this.googleId; 
    },
    // Add a custom validator to allow null/empty for Google users
    validate: {
      validator: function(value) {
        // For Google users without email, allow empty
        if (this.googleId && !value) return true;
        // For regular users, require email
        return !!value;
      },
      message: 'Email is required for non-Google users'
    }
  },
  profilePic: { type: String },
  password: { type: String }, 
  favorites: [
    {
      title: { type: String, required: true },
      path: { type: String, required: true },
      addedAt: { type: Date, default: Date.now },
      thumbnailUrl: { type: String },
    }
  ],
  watchHistory: [
    {
      roomId: { type: String },
      movieTitle: { type: String },
      moviePath: { type: String },
      watchedAt: { type: Date, default: Date.now },
      duration: { type: Number }, // Duration in seconds
      watchedDuration: { type: Number }, // How much of the movie was watched
    }
  ],
  friends: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }
  ],
});

// Add method to compare passwords
UserSchema.methods.matchPassword = async function (enteredPassword) {
  // If user has no password (e.g. Google auth), always return false
  if (!this.password) return false;
  
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", UserSchema);
