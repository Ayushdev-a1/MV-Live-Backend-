const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  googleId: { type: String, unique: true },
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
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

module.exports = mongoose.model("User", UserSchema);
