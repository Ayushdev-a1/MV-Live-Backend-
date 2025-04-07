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

    const roomId = generateRoomId(); // Generate a unique room ID

    const room = await Room.create({
      roomId,
      name,
      description,
      createdBy: req.user._id,
      currentMedia,
      isPrivate: isPrivate || false,
      settings,
      participants: [req.user._id],
    });

    // Construct the shareable link using roomId
    const shareableLink = `${req.protocol}://${req.get("host")}/room?roomId=${roomId}`;

    res.status(201).json({
      ...room._doc,
      shareableLink, // Return the shareable link with the response
    });
  } catch (error) {
    console.error("Create room error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all public rooms
router.get("/", async (req, res) => {
  try {
    const rooms = await Room.find({ isPrivate: false })
      .populate("createdBy", "name profilePic")
      .sort({ lastActive: -1 });

    // Add shareableLink to each room in the response
    const roomsWithLinks = rooms.map((room) => ({
      ...room._doc,
      shareableLink: `${req.protocol}://${req.get("host")}/room?roomId=${room.roomId}`,
    }));

    res.json(roomsWithLinks);
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

    // Add shareableLink to the response
    const roomWithLink = {
      ...room._doc,
      shareableLink: `${req.protocol}://${req.get("host")}/room?roomId=${room.roomId}`,
    };

    res.json(roomWithLink);
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

    // Only creator can update room
    if (room.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to update this room" });
    }

    const { name, description, isPrivate, settings } = req.body;

    if (name) room.name = name;
    if (description !== undefined) room.description = description;
    if (isPrivate !== undefined) room.isPrivate = isPrivate;
    if (settings) room.settings = { ...room.settings, ...settings };

    await room.save();

    // Add shareableLink to the response
    const roomWithLink = {
      ...room._doc,
      shareableLink: `${req.protocol}://${req.get("host")}/room?roomId=${room.roomId}`,
    };

    res.json(roomWithLink);
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

    // Check if user is authorized (room creator or media uploader)
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

    // Only creator or participants can update current media if settings allow
    if (
      room.createdBy.toString() !== req.user._id.toString() &&
      !room.participants.some((p) => p.toString() === req.user._id.toString())
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // If not creator, check if media control is allowed
    if (
      room.createdBy.toString() !== req.user._id.toString() &&
      !room.settings.allowMediaControl
    ) {
      return res.status(403).json({ message: "Media control is restricted to the host" });
    }

    const { title, url, type, duration, thumbnailUrl, genre, year, director } = req.body;

    // Add current media to history if changing
    if (room.currentMedia && room.currentMedia.url && room.currentMedia.url !== url) {
      room.roomHistory.push({
        mediaTitle: room.currentMedia.title,
        mediaUrl: room.currentMedia.url,
        watchedAt: new Date(),
        participants: [...room.participants],
      });

      // Limit history to 20 items
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

    // Add shareableLink to the response
    const roomWithLink = {
      ...room._doc,
      shareableLink: `${req.protocol}://${req.get("host")}/room?roomId=${room.roomId}`,
    };

    res.json(roomWithLink);
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

    // Only creator can delete room
    if (room.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to delete this room" });
    }

    await room.remove();
    res.json({ message: "Room deleted" });
  } catch (error) {
    console.error("Delete room error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;