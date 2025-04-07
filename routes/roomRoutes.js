const express = require("express");
const router = express.Router();
const Room = require("../models/Room");
const { protect } = require("../middleware/authMiddleware");

// Custom ID generator function
function generateRoomId(length = 8) {
  const chars = "1234567890abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Protect all routes with authentication middleware
router.use(protect);

// Create a room
router.post("/", async (req, res) => {
  try {
    const { name, description, isPrivate, settings = {}, currentMedia = {} } = req.body;

    let roomId;
    let attempts = 0;
    const maxAttempts = 5;

    // Ensure roomId is unique
    do {
      roomId = generateRoomId();
      const existingRoom = await Room.findOne({ roomId });
      if (!existingRoom) break;
      attempts++;
      if (attempts >= maxAttempts) {
        return res.status(500).json({ message: "Unable to generate unique room ID" });
      }
    } while (true);

    const room = await Room.create({
      roomId,
      name,
      description,
      createdBy: req.user._id,
      currentMedia,
      isPrivate: isPrivate || false,
      settings,
      participants: [req.user._id],
      inviteLink: `${req.protocol}://${req.get("host")}/room?roomId=${roomId}`, // Store inviteLink in DB
    });

    res.status(201).json({
      ...room._doc,
      inviteLink: room.inviteLink, // Return the invite link
    });
  } catch (error) {
    console.error("Create room error:", error);
    if (error.code === 11000) {
      res.status(400).json({ message: "Duplicate room ID or invite link detected" });
    } else {
      res.status(500).json({ message: "Server error" });
    }
  }
});

// Get all public rooms
router.get("/", async (req, res) => {
  try {
    const rooms = await Room.find({ isPrivate: false })
      .populate("createdBy", "name profilePic")
      .sort({ lastActive: -1 });

    res.json(rooms); // inviteLink is already in the document
  } catch (error) {
    console.error("Get rooms error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get room details by roomId
router.get("/:roomId", async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId })
      .populate("createdBy", "name profilePic")
      .populate("participants", "name profilePic");

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    res.json(room); // inviteLink is included
  } catch (error) {
    console.error("Get room error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update room details
router.put("/:roomId", async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    if (room.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to update this room" });
    }

    const { name, description, isPrivate, settings } = req.body;

    if (name) room.name = name;
    if (description !== undefined) room.description = description;
    if (isPrivate !== undefined) room.isPrivate = isPrivate;
    if (settings) room.settings = { ...room.settings, ...settings };

    await room.save();
    res.json(room); // inviteLink is included
  } catch (error) {
    console.error("Update room error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Add item to playlist
router.post("/:roomId/playlist", async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    const { title, url, duration, thumbnailUrl } = req.body;

    if (!title || !url) {
      return res.status(400).json({ message: "Title and URL are required" });
    }

    room.playlist.push({
      title,
      url,
      duration,
      thumbnailUrl,
      addedBy: req.user._id,
      addedAt: new Date(),
    });

    await room.save();
    res.status(201).json(room.playlist);
  } catch (error) {
    console.error("Add to playlist error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Remove item from playlist
router.delete("/:roomId/playlist/:itemId", async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    const playlistItem = room.playlist.id(req.params.itemId);

    if (!playlistItem) {
      return res.status(404).json({ message: "Playlist item not found" });
    }

    if (
      room.createdBy.toString() !== req.user._id.toString() &&
      playlistItem.addedBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Not authorized to remove this item" });
    }

    room.playlist.id(req.params.itemId).remove();
    await room.save();
    res.json(room.playlist);
  } catch (error) {
    console.error("Remove from playlist error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update current media
router.put("/:roomId/current-media", async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    if (
      room.createdBy.toString() !== req.user._id.toString() &&
      !room.participants.some((p) => p.toString() === req.user._id.toString())
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (
      room.createdBy.toString() !== req.user._id.toString() &&
      !room.settings.allowMediaControl
    ) {
      return res.status(403).json({ message: "Media control is restricted to the host" });
    }

    const { title, url, type, duration, thumbnailUrl, genre, year, director } = req.body;

    if (room.currentMedia && room.currentMedia.url && room.currentMedia.url !== url) {
      room.roomHistory.push({
        mediaTitle: room.currentMedia.title,
        mediaUrl: room.currentMedia.url,
        watchedAt: new Date(),
        participants: [...room.participants],
      });

      if (room.roomHistory.length > 20) {
        room.roomHistory = room.roomHistory.slice(-20);
      }
    }

    room.currentMedia = {
      title,
      url,
      type,
      duration,
      thumbnailUrl,
      genre,
      year,
      director,
      uploadedBy: req.user._id,
      uploadedAt: new Date(),
    };

    room.lastActive = new Date();
    await room.save();
    res.json(room); // inviteLink is included
  } catch (error) {
    console.error("Update current media error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get room history
router.get("/:roomId/history", async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    res.json(room.roomHistory.sort((a, b) => b.watchedAt - a.watchedAt));
  } catch (error) {
    console.error("Get room history error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete a room
router.delete("/:roomId", async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    if (room.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to delete this room" });
    }

    await room.deleteOne(); // Updated from .remove() to .deleteOne()
    res.json({ message: "Room deleted" });
  } catch (error) {
    console.error("Delete room error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;