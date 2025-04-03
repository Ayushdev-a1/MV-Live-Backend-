const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  googleId: { type: String, unique: true },
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  profilePic: { type: String },
  password: { type: String }, 
});

module.exports = mongoose.model("User", UserSchema);
