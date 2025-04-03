const express = require("express")
const {
  createRoom,
  joinRoom,
  getRoomDetails,
  updateMedia,
  getRoomMessages,
  leaveRoom,
  listRooms,
} = require("../controllers/room.controller")
const { protect } = require("../middleware/authMiddleware")

const router = express.Router()

// Protect all routes
router.use(protect)

// Room routes
router.post("/", createRoom)
router.get("/", listRooms)
router.get("/:roomId", getRoomDetails)
router.post("/:roomId/join", joinRoom)
router.post("/:roomId/leave", leaveRoom)
router.put("/:roomId/media", updateMedia)
router.get("/:roomId/messages", getRoomMessages)

module.exports = router