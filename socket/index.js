const Message = require("../models/Message")
const Room = require("../models/Room")
const User = require("../models/User")
const mongoose = require("mongoose")

// Fix circular dependency by not referencing global.io inside this module
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
    const playlists = {} // Track playlist per room

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

        // Initialize room playlist if needed
        if (!playlists[roomId]) {
          try {
            // Load playlist from database
            playlists[roomId] = room.playlist || [];
          } catch (error) {
            console.error("Error loading playlist:", error);
            playlists[roomId] = [];
          }
        }

        // Notify room about new user and send current state
        io.to(roomId).emit("user-count", connectedUsers.length)

        // Notify everyone except the joining user
        socket.to(roomId).emit("user-joined", socket.id)

        // Send video source to the joining user
        socket.emit("video-source", videoSources[roomId] || "/video/sample.mp4")
        
        // Send current playlist to the joining user
        socket.emit("playlist-update", playlists[roomId] || [])

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

    socket.on("change-video-source", async (data) => {
      if (!socket.isHost || !socket.roomId) {
        return socket.emit("error", { message: "Only hosts can change video source" })
      }

      try {
        const { roomId, source, movieMetadata = {} } = data
        if (!source) {
          return socket.emit("error", { message: "Invalid video source" })
        }

        console.log(`Changing video source in room ${roomId} to ${source}`)

        // Update video source for the room
        videoSources[roomId] = source

        // Reset host state
        hostStates[roomId] = { time: 0, playing: true }

        // Broadcast to all users in the room
        io.to(roomId).emit("video-source-changed", source)

        // Also send movie metadata
        io.to(roomId).emit("movie-metadata", {
          ...movieMetadata,
          source
        });
      } catch (error) {
        console.error("Error changing video source:", error)
        socket.emit("error", { message: "Failed to change video source" })
      }
    })

    // Add to playlist
    socket.on("add-to-playlist", async (data) => {
      if (!socket.roomId) return;
      
      try {
        const { title, url, duration, thumbnailUrl } = data;
        
        if (!title || !url) {
          return socket.emit("error", { message: "Invalid playlist item" });
        }
        
        const newItem = {
          title,
          url,
          duration,
          thumbnailUrl,
          addedBy: socket.user.userId,
          addedAt: new Date()
        };
        
        // Update memory playlist
        if (!playlists[socket.roomId]) {
          playlists[socket.roomId] = [];
        }
        playlists[socket.roomId].push(newItem);
        
        // Update database
        const room = await Room.findOne({ roomId: socket.roomId });
        if (room) {
          room.playlist.push({
            title,
            url,
            duration,
            thumbnailUrl,
            addedBy: socket.user.userId,
            addedAt: new Date()
          });
          await room.save();
        }
        
        // Notify all users in the room
        io.to(socket.roomId).emit("playlist-update", playlists[socket.roomId]);
      } catch (error) {
        console.error("Error adding to playlist:", error);
        socket.emit("error", { message: "Failed to add to playlist" });
      }
    });
    
    // Remove from playlist
    socket.on("remove-from-playlist", async (data) => {
      if (!socket.roomId) return;
      
      try {
        const { index } = data;
        
        // Check if valid index
        if (index < 0 || !playlists[socket.roomId] || index >= playlists[socket.roomId].length) {
          return socket.emit("error", { message: "Invalid playlist item" });
        }
        
        // Check if user has permission (host or added the item)
        const item = playlists[socket.roomId][index];
        const room = await Room.findOne({ roomId: socket.roomId });
        
        if (!room) {
          return socket.emit("error", { message: "Room not found" });
        }
        
        if (!socket.isHost && item.addedBy.toString() !== socket.user.userId) {
          return socket.emit("error", { message: "You don't have permission to remove this item" });
        }
        
        // Update memory playlist
        playlists[socket.roomId].splice(index, 1);
        
        // Update database
        if (room.playlist[index]) {
          room.playlist.splice(index, 1);
          await room.save();
        }
        
        // Notify all users in the room
        io.to(socket.roomId).emit("playlist-update", playlists[socket.roomId]);
      } catch (error) {
        console.error("Error removing from playlist:", error);
        socket.emit("error", { message: "Failed to remove from playlist" });
      }
    });
    
    // Play next item in playlist
    socket.on("play-next-in-playlist", async () => {
      if (!socket.roomId || !socket.isHost) return;
      
      try {
        if (!playlists[socket.roomId] || playlists[socket.roomId].length === 0) {
          return socket.emit("error", { message: "Playlist is empty" });
        }
        
        // Get the next item
        const nextItem = playlists[socket.roomId][0];
        
        // Change video source
        socket.emit("change-video-source", {
          roomId: socket.roomId,
          source: nextItem.url,
          movieMetadata: {
            title: nextItem.title,
            duration: nextItem.duration,
            thumbnailUrl: nextItem.thumbnailUrl
          }
        });
        
        // Remove from playlist
        socket.emit("remove-from-playlist", { index: 0 });
      } catch (error) {
        console.error("Error playing next in playlist:", error);
        socket.emit("error", { message: "Failed to play next item" });
      }
    });

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

        // Validate message
        if (!message.trim()) {
          return
        }

        // Store in database
        const newMessage = new Message({
          room: room._id,
          user: socket.user.userId,
          text: message,
          timestamp: new Date(),
        })

        await newMessage.save()

        // Add to room messages
        room.messages.push(newMessage._id)
        await room.save()

        // Broadcast to room
        io.to(roomId).emit("chat-message", {
          userId: socket.user.userId,
          username: socket.user.username,
          message,
          timestamp: new Date(),
        })
      } catch (error) {
        console.error("Error handling chat message:", error)
        socket.emit("error", { message: "Failed to send message" })
      }
    })

    // Handle disconnection
    socket.on("disconnect", async () => {
      try {
        console.log(`User disconnected: ${socket.user?.username || 'Unknown'} (${socket.id})`)
        
        // Notify room about user leaving
        if (socket.roomId) {
          socket.to(socket.roomId).emit("user-left", socket.id)
          
          // Update room participants in the database
          const room = await Room.findOne({ roomId: socket.roomId })
          if (room) {
            const roomUsers = Array.from(await io.in(socket.roomId).allSockets())
            io.to(socket.roomId).emit("user-count", roomUsers.length)
            
            // If this was the last user, update room status
            if (roomUsers.length === 0) {
              room.active = false
              room.lastActive = new Date()
              await room.save()
            }
          }
        }
      } catch (error) {
        console.error("Error handling disconnection:", error)
      }
    })
  })
}

// Don't create any references to io here, just export the handler function
module.exports = { initializeSocketHandlers } 