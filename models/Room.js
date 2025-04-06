const mongoose = require("mongoose")

const RoomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  currentMedia: {
    title: String,
    url: String,
    type: {
      type: String,
      enum: ["movie", "series"],
    },
    duration: Number,
    thumbnailUrl: String,
    genre: String,
    year: Number,
    director: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    }
  },
  participants: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  isPrivate: {
    type: Boolean,
    default: false,
  },
  settings: {
    allowChat: { type: Boolean, default: true },
    allowMediaControl: { type: Boolean, default: true },
    allowVideoChat: { type: Boolean, default: true },
    maxParticipants: { type: Number, default: 10 },
    autoPlay: { type: Boolean, default: true },
    roomPassword: { type: String },
    allowJoinRequests: { type: Boolean, default: true }
  },
  playlist: [
    {
      title: String,
      url: String,
      duration: Number,
      thumbnailUrl: String,
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      addedAt: {
        type: Date,
        default: Date.now,
      }
    }
  ],
  messages: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    }
  ],
  roomHistory: [
    {
      mediaTitle: String,
      mediaUrl: String,
      watchedAt: { type: Date, default: Date.now },
      participants: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        }
      ]
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Room", RoomSchema);