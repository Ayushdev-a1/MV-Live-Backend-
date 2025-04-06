const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  googleId: { type: String, sparse: true },
  name: { type: String, required: true },
  email: { 
    type: String, 
    unique: true, 
    required: function() { 
      return !this.googleId; 
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
