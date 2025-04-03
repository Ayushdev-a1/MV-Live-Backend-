require("dotenv").config()
const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")
const mongoose = require("mongoose")
const passport = require("passport")
const session = require("express-session")
const multer = require("multer")
const path = require("path")
const fs = require("fs")

const connectDB = require("./config/db")
require("./config/oauth")
const { initializeSocketHandlers } = require("./socket")
const authRoutes = require("./routes/authRoutes")
const roomRoutes = require("./routes/roomRoutes")
const userRoutes = require("./routes/userRoutes")
const { errorHandler } = require("./middleware/error.middleware")
const db = require('./config/db')

const app = express()
const server = http.createServer(app)

// CORS configuration with proper headers for large file uploads
app.use(
  cors({
    origin: process.env.ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Explicitly allow OPTIONS
    allowedHeaders: ["Content-Type", "Authorization"], // Allow common headers
    credentials: true,
    exposedHeaders: ["Content-Disposition", "Content-Length"],
  }),
);

// Middleware
app.use(express.json())
app.use(express.static("client"))

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads")
if (!fs.existsSync(uploadsDir)) {
  console.log("Creating uploads directory...")
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// Serve uploads with correct Content-Type and proper headers
app.use(
  "/uploads",
  express.static(uploadsDir, {
    setHeaders: (res, filePath) => {
      if (path.extname(filePath) === ".mp4") {
        res.setHeader("Content-Type", "video/mp4")
        res.setHeader("Accept-Ranges", "bytes")
      }
    },
  }),
)

// Configure multer with better error handling and limits
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
    const fileExt = path.extname(file.originalname)
    cb(null, `${uniqueSuffix}${fileExt}`)
  },
})

// Create multer instance with appropriate limits
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB limit - adjust as needed
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true)
    } else {
      cb(new Error("Only video files are allowed!"), false)
    }
  },
})

// Improved video upload endpoint with better error handling
app.post("/upload-video", (req, res) => {
  console.log("Upload request received")

  // Use single file upload with error handling
  upload.single("video")(req, res, (err) => {
    if (err) {
      console.error("Upload error:", err)
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: "File is too large. Maximum size is 200MB.",
        })
      }
      return res.status(400).json({
        error: err.message || "Error uploading file",
      })
    }

    if (!req.file) {
      console.error("No file uploaded")
      return res.status(400).json({ error: "No file uploaded." })
    }

    const filePath = `/uploads/${req.file.filename}`
    console.log(`Video uploaded successfully: ${filePath}`)

    res.json({
      path: filePath,
      size: req.file.size,
      mimetype: req.file.mimetype,
      filename: req.file.filename,
    })
  })
})

// Improved video streaming with range support
app.get("/uploads/:filename", (req, res) => {
  const filename = req.params.filename
  const filePath = path.join(uploadsDir, filename)

  // Check if file exists
  fs.stat(filePath, (err, stats) => {
    if (err) {
      if (err.code === "ENOENT") {
        return res.status(404).send("File not found")
      }
      return res.status(500).send("Internal server error")
    }

    // Get file size
    const fileSize = stats.size
    const range = req.headers.range

    // Handle range requests (important for video streaming)
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-")

      const start = Number.parseInt(parts[0], 10)
      const end = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1

      const chunkSize = end - start + 1
      const file = fs.createReadStream(filePath, { start, end })

      const headers = {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "video/mp4",
      }

      res.writeHead(206, headers)
      file.pipe(res)
    } else {
      // No range requested, send entire file
      const headers = {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
      }

      res.writeHead(200, headers)
      fs.createReadStream(filePath).pipe(res)
    }
  })
})

app.use(
  session({
    secret: process.env.SESSION_SECRET || "defaultsecret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true if using HTTPS
  }),
)
app.use(passport.initialize())
app.use(passport.session())

// Configure Socket.IO with better settings for video streaming
const io = new Server(server, {
  cors: {
    origin: process.env.ORIGIN || "https://mv-live.netlify.app/",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 1e8, // 100MB
});

global.io = io


db()

// Routes
app.use("/auth", authRoutes)
app.use("/api/rooms", roomRoutes)
app.use("/api/users", userRoutes)

// Initialize Socket handlers
initializeSocketHandlers(io)

// Error handling middleware
app.use(errorHandler)

// Start server
const PORT = process.env.PORT || 5000
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})

module.exports = { io }