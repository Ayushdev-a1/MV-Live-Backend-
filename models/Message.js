const mongoose = require("mongoose")

const MessageSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    ref: "Room",
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  content: {
    type: String,
    required: true,
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

module.exports = mongoose.model("Message", MessageSchema)