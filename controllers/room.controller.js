const { v4: uuidv4 } = require("uuid")
const Room = require("../models/Room")
const Message = require("../models/Message")
const { catchAsync } = require("../utils/catchAsync")
const { io } = require("../server")

// Create a new room
exports.createRoom = catchAsync(async (req, res) => {
  const { name, description, isPrivate } = req.body;
  const userId = req.user.id || req.user._id; // Support both formats

  // Generate a unique room ID 
  const roomId = uuidv4();

  // Generate a shareable link
  const inviteLink = `${req.protocol}://${req.get("host") || 'localhost:5000'}/api/rooms/${roomId}/join`;

  // Create new room
  const room = new Room({
    roomId,
    name,
    description,
    createdBy: userId,
    participants: [userId], 
    isPrivate: isPrivate || false,
    inviteLink: inviteLink // Explicitly set invite link
  });

  await room.save();

  // Return the room data with the roomId included at the top level
  res.status(201).json({
    success: true,
    roomId: room.roomId, // Include roomId at top level for easier access
    data: {
      room,
      shareableLink: inviteLink,
    },
  });
});

// Join a room
exports.joinRoom = catchAsync(async (req, res) => {
  const { roomId } = req.params
  const userId = req.user.id

  // Find room by ID
  const room = await Room.findOne({ roomId })
  if (!room) {
    return res.status(404).json({
      success: false,
      message: "Room not found",
    })
  }

  // Check if user is already in the room
  if (!room.participants.includes(userId)) {
    room.participants.push(userId)
    await room.save()

    // ✅ Use global `io`
    global.io.to(roomId).emit("userJoined", {
      userId,
      username: req.user.username,
    })
  }

  res.status(200).json({
    success: true,
    data: {
      room,
    },
  })
})

// Get room details
exports.getRoomDetails = catchAsync(async (req, res) => {
  const { roomId } = req.params

  // Find room by ID and populate creator and participants
  const room = await Room.findOne({ roomId }).populate("createdBy", "username").populate("participants", "username")

  if (!room) {
    return res.status(404).json({
      success: false,
      message: "Room not found",
    })
  }

  res.status(200).json({
    success: true,
    data: {
      room,
    },
  })
})

// Update current media
exports.updateMedia = catchAsync(async (req, res) => {
  const { roomId } = req.params
  const { title, url, type, duration } = req.body
  const userId = req.user.id

  // Find room by ID
  const room = await Room.findOne({ roomId })
  if (!room) {
    return res.status(404).json({
      success: false,
      message: "Room not found",
    })
  }

  // Check if user is the creator or a participant
  if (!room.participants.includes(userId)) {
    return res.status(403).json({ 
      success: false,
      message: "Not authorized to update this room",
    })
  }

  // Update media
  room.currentMedia = {
    title,
    url,
    type,
    duration,
  }
  room.lastActive = new Date()
  await room.save()

  // Notify all participants about media change
  io.to(roomId).emit("mediaUpdated", {
    media: room.currentMedia,
    updatedBy: req.user.username,
  })

  res.status(200).json({
    success: true,
    data: {
      room,
    },
  })
})

// Get room messages
exports.getRoomMessages = catchAsync(async (req, res) => {
  const { roomId } = req.params
  const userId = req.user.id

  // Find room by ID
  const room = await Room.findOne({ roomId })
  if (!room) {
    return res.status(404).json({
      success: false,
      message: "Room not found",
    })
  }

  // Check if user is a participant
  if (!room.participants.includes(userId)) {
    return res.status(403).json({
      success: false,
      message: "Not authorized to view messages in this room",
    })
  }

  // Get messages for the room
  const messages = await Message.find({ roomId }).populate("sender", "username").sort({ createdAt: 1 })

  res.status(200).json({
    success: true,
    data: {
      messages,
    },
  })
})

// Leave room
exports.leaveRoom = catchAsync(async (req, res) => {
  const { roomId } = req.params
  const userId = req.user.id

  // Find room by ID
  const room = await Room.findOne({ roomId })
  if (!room) {
    return res.status(404).json({
      success: false,
      message: "Room not found",
    })
  }

  // Remove user from participants
  room.participants = room.participants.filter((participant) => participant.toString() !== userId)
  await room.save()

  // Notify room members about participant leaving
  io.to(roomId).emit("userLeft", {
    userId,
    username: req.user.username,
  })

  res.status(200).json({
    success: true,
    message: "Successfully left the room",
  })
})

// List all rooms (with optional filters)
exports.listRooms = catchAsync(async (req, res) => {
  const { isPrivate, search } = req.query

  // Build query
  const query = {}

  if (isPrivate !== undefined) {
    query.isPrivate = isPrivate === "true"
  }

  if (search) {
    query.$or = [{ name: { $regex: search, $options: "i" } }, { description: { $regex: search, $options: "i" } }]
  }

  // Find rooms
  const rooms = await Room.find(query).populate("createdBy", "username").sort({ lastActive: -1 })

  res.status(200).json({
    success: true,
    count: rooms.length,
    data: {
      rooms,
    },
  })
})
