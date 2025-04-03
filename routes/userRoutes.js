const express = require("express")
const { protect } = require("../middleware/authMiddleware")

const router = express.Router()

// Protect all routes
router.use(protect)

// User routes can be added here

module.exports = router
