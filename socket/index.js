const Message = require("../models/Message")
const Room = require("../models/Room")
const mongoose = require("mongoose")

const initializeSocketHandlers = (io) => {
  io.on("connection", (socket) => {
    const googleId = socket.handshake.auth.googleId
    const username = socket.handshake.auth.username
    const userId = socket.handshake.auth.userId

    if (!googleId || !username || !userId) {
      console.error("Authentication error: Google ID or username missing")
      socket.disconnect()
      return
    }

    socket.user = { id: googleId, username, userId }
    console.log(`User connected: ${socket.user.username} (${socket.id})`)

    const activePeers = new Map()
    const roomScreenSharing = new Map()
    const hostStates = {} // Track host's video state per room
    const videoSources = {} // Track video source per room

    // Handle WebRTC signaling with improved error handling
    socket.on("offer", (data) => {
      try {
        const { target, offer } = data
        if (!target) {
          console.error("Missing target in offer")
          return
        }

        console.log(`Forwarding offer from ${socket.id} to ${target}`)

        io.to(target).emit("offer", {
          offer,
          from: socket.id,
        })
      } catch (error) {
        console.error("Error handling offer:", error)
        socket.emit("error", { message: "Failed to process offer" })
      }
    })

    socket.on("answer", (data) => {
      try {
        const { target, answer } = data
        if (!target) {
          console.error("Missing target in answer")
          return
        }

        console.log(`Forwarding answer from ${socket.id} to ${target}`)

        io.to(target).emit("answer", {
          answer,
          from: socket.id,
        })
      } catch (error) {
        console.error("Error handling answer:", error)
        socket.emit("error", { message: "Failed to process answer" })
      }
    })

    socket.on("ice-candidate", (data) => {
      try {
        const { target, candidate } = data
        if (!target) {
          console.error("Missing target in ICE candidate")
          return
        }

        console.log(`Forwarding ICE candidate from ${socket.id} to ${target}`)

        io.to(target).emit("ice-candidate", {
          candidate,
          from: socket.id,
        })
      } catch (error) {
        console.error("Error handling ICE candidate:", error)
        socket.emit("error", { message: "Failed to process ICE candidate" })
      }
    })

    socket.on("toggle-media", (data) => {
      try {
        if (!socket.roomId) {
          console.error("Room ID missing for media toggle")
          return
        }

        console.log(`Media toggle from ${socket.id}: camera=${data.cameraOn}, mic=${data.micOn}`)

        io.to(socket.roomId).emit("media-status", {
          userId: socket.id,
          cameraOn: data.cameraOn,
          micOn: data.micOn,
        })
      } catch (error) {
        console.error("Error handling media toggle:", error)
        socket.emit("error", { message: "Failed to update media status" })
      }
    })

    socket.on("join-room", async (roomId, isHost) => {
      if (!socket.user || !roomId) {
        socket.emit("error", { message: "Invalid room join request" })
        return
      }

      try {
        const room = await Room.findOne({ roomId })
        if (!room) {
          socket.emit("error", { message: "Room not found" })
          return
        }

        // Leave any previous rooms
        if (socket.roomId && socket.roomId !== roomId) {
          socket.leave(socket.roomId)
          io.to(socket.roomId).emit("user-left", socket.id)

          const prevRoomUsers = await io.in(socket.roomId).allSockets()
          io.to(socket.roomId).emit("user-count", prevRoomUsers.size)
        }

        // Join the new room
        socket.join(roomId)
        socket.isHost = isHost
        socket.roomId = roomId
        console.log(`${socket.user.username} joined room: ${roomId} as ${isHost ? "host" : "guest"}`)

        // Update room participants in database
        const participantExists = room.participants.some(
          (p) => p.toString() === socket.user.userId || p.equals(socket.user.userId),
        )

        if (!participantExists) {
          room.participants.push(socket.user.userId)
        }

        room.lastActive = new Date()
        await room.save()

        // Get all users in the room
        const roomUsers = await io.in(roomId).allSockets()
        const connectedUsers = Array.from(roomUsers)
          .map((socketId) => {
            const userSocket = io.sockets.sockets.get(socketId)
            return userSocket?.user
              ? {
                  userId: userSocket.user.userId,
                  googleId: userSocket.user.id,
                  username: userSocket.user.username,
                  socketId: socketId,
                  isHost: userSocket.isHost || false,
                }
              : null
          })
          .filter(Boolean)

        // Initialize host state and video source if needed
        if (isHost) {
          hostStates[roomId] = hostStates[roomId] || { time: 0, playing: false }
          videoSources[roomId] = videoSources[roomId] || "/video/sample.mp4"
        }

        // Notify room about new user and send current state
        io.to(roomId).emit("user-count", connectedUsers.length)

        // Notify everyone except the joining user
        socket.to(roomId).emit("user-joined", socket.id)

        // Send video source to the joining user
        socket.emit("video-source", videoSources[roomId] || "/video/sample.mp4")

        // Notify the new user about existing peers
        socket.emit(
          "existing-users",
          connectedUsers.filter((user) => user.socketId !== socket.id),
        )

        console.log(`Room ${roomId} now has ${connectedUsers.length} users`)
      } catch (error) {
        console.error("Error in join-room:", error)
        socket.emit("error", { message: "Failed to join room" })
      }
    })

    socket.on("host-state", (data) => {
      if (socket.isHost && socket.roomId) {
        const { roomId, time, playing } = data
        hostStates[roomId] = { time, playing }
      }
    })

    socket.on("pause-all", (roomId) => {
      if (socket.isHost && socket.roomId === roomId) {
        hostStates[roomId] = { time: hostStates[roomId].time, playing: false }
        io.to(roomId).emit("pause-all-streams", hostStates[roomId].time)
      }
    })

    socket.on("change-video-source", (data) => {
      if (!socket.isHost || !socket.roomId) {
        socket.emit("error", { message: "Only hosts can change video source" })
        return
      }

      try {
        const { roomId, source } = data

        // Validate source
        if (!source) {
          socket.emit("error", { message: "Invalid video source" })
          return
        }

        console.log(`Host ${socket.user.username} changing video source in room ${roomId} to: ${source}`)

        // Update video source
        videoSources[roomId] = source

        // Reset host state when changing video
        hostStates[roomId] = { time: 0, playing: false }

        // Notify all users in the room
        io.to(roomId).emit("video-source", source)
      } catch (error) {
        console.error("Error changing video source:", error)
        socket.emit("error", { message: "Failed to change video source" })
      }
    })

    socket.on("chat-message", async (data) => {
      if (!socket.user || !socket.roomId) return

      try {
        const { roomId, message } = data
        const room = await Room.findOne({ roomId })
        if (!room) {
          socket.emit("error", { message: "Room not found" })
          return
        }

        if (!(room.settings?.allowChat ?? true)) {
          socket.emit("error", { message: "Chat is disabled in this room" })
          return
        }

        const msg = new Message({
          roomId,
          sender: mongoose.Types.ObjectId.isValid(socket.user.userId)
            ? socket.user.userId
            : new mongoose.Types.ObjectId(),
          content: message,
        })

        await msg.save()
        io.to(roomId).emit("chat-message", {
          userId: socket.user.id,
          message,
          timestamp: new Date(),
        })
      } catch (error) {
        console.error("Error sending message:", error)
        socket.emit("error", { message: "Failed to send message" })
      }
    })

    socket.on("leaveRoom", async ({ roomId }) => {
      if (!socket.user) return

      try {
        socket.leave(roomId)
        activePeers.delete(socket.id)

        if (roomScreenSharing.has(roomId) && roomScreenSharing.get(roomId).socketId === socket.id) {
          roomScreenSharing.delete(roomId)
          io.to(roomId).emit("screenShareEnded")
        }

        io.to(roomId).emit("user-left", socket.id)

        const roomUsers = await io.in(roomId).allSockets()
        const connectedUsers = Array.from(roomUsers)
          .map((socketId) => {
            const userSocket = io.sockets.sockets.get(socketId)
            return userSocket?.user
              ? {
                  userId: userSocket.user.userId,
                  googleId: userSocket.user.id,
                  username: userSocket.user.username,
                  socketId,
                }
              : null
          })
          .filter(Boolean)

        io.to(roomId).emit("user-count", connectedUsers.length)

        if (connectedUsers.length === 0) {
          delete hostStates[roomId]
          delete videoSources[roomId]
        }
      } catch (error) {
        console.error("Error in leaveRoom:", error)
      }
    })

    socket.on("disconnect", async () => {
      if (!socket.user) return

      activePeers.delete(socket.id)

      const rooms = Array.from(socket.rooms)
      for (const roomId of rooms) {
        if (roomId !== socket.id) {
          try {
            if (roomScreenSharing.has(roomId) && roomScreenSharing.get(roomId).socketId === socket.id) {
              roomScreenSharing.delete(roomId)
              io.to(roomId).emit("screenShareEnded")
            }

            io.to(roomId).emit("user-left", socket.id)

            const roomUsers = await io.in(roomId).allSockets()
            const connectedUsers = Array.from(roomUsers)
              .map((socketId) => {
                const userSocket = io.sockets.sockets.get(socketId)
                return userSocket?.user
                  ? {
                      userId: userSocket.user.userId,
                      googleId: userSocket.user.id,
                      username: userSocket.user.username,
                      socketId,
                    }
                  : null
              })
              .filter(Boolean)

            io.to(roomId).emit("user-count", connectedUsers.length)

            if (connectedUsers.length === 0) {
              delete hostStates[roomId]
              delete videoSources[roomId]
            }
          } catch (error) {
            console.error("Error in disconnect:", error)
          }
        }
      }
      console.log(`User disconnected: ${socket.user.username}`)
    })

    // Broadcast host state every second
    setInterval(() => {
      for (const roomId in hostStates) {
        io.to(roomId).emit("live-state", hostStates[roomId])
      }
    }, 1000)
  })
}

module.exports = { initializeSocketHandlers }