require("dotenv").config()
const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")
const mongoose = require("mongoose")
const passport = require("passport")
const session = require("express-session")
const MongoStore = require('connect-mongo')
const multer = require("multer")
const path = require("path")
const fs = require("fs")

const connectDB = require("./config/db")
// Connect to database early to fail fast if there's an issue
connectDB().catch(console.error);

require("./config/oauth")
const { initializeSocketHandlers } = require("./socket")
const authRoutes = require("./routes/authRoutes")
const roomRoutes = require("./routes/roomRoutes")
const userRoutes = require("./routes/userRoutes")
const { errorHandler } = require("./middleware/error.middleware")

// Create Express app and HTTP server
const app = express()
const server = http.createServer(app)

// ===== START OF CORS FIX =====
// Allow specified origins
const allowedOrigins = ['https://mv-live.netlify.app', 'http://localhost:5173'];

// Basic CORS middleware enabling credentials
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(null, false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
}));

// Middleware to handle all OPTIONS requests and set CORS headers for all responses
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
});

// Handle all OPTIONS requests explicitly at the route level
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.status(204).end();
});
// ===== END OF CORS FIX =====

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

// Configure session with MongoDB store to fix the MemoryStore warning
app.use(
  session({
    secret: process.env.SESSION_SECRET || "defaultsecret",
    resave: true,  // Changed to true to ensure session is saved on every request
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      ttl: 24 * 60 * 60, // Session TTL (1 day)
      autoRemove: 'native', // Use MongoDB's TTL collection feature
      collectionName: 'sessions',
      stringify: false,
      touchAfter: 60, // Update session more frequently (once per minute)
      // MongoDB connection options for serverless
      clientPromise: (async () => {
        // Reuse existing connection if available
        if (mongoose.connection.readyState === 1) {
          return mongoose.connection.getClient();
        }
        
        // Otherwise try to connect
        await connectDB();
        return mongoose.connection.getClient();
      })()
    }),
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.vercel.app' : undefined
    },
    name: 'mv-live-sid', // Custom name for better security
  })
)

app.use(passport.initialize())
app.use(passport.session())

// Log session status on every request
app.use((req, res, next) => {
  if (req.path !== '/api/health' && req.path !== '/favicon.ico') {
    console.log(`[${new Date().toISOString()}] Request path: ${req.method} ${req.path}`);
    console.log(`Session exists: ${!!req.session}`);
    console.log(`User authenticated: ${req.isAuthenticated ? req.isAuthenticated() : false}`);
    console.log(`Session ID: ${req.sessionID}`);
    if (req.session && req.session.passport) {
      console.log(`Session passport user: ${req.session.passport.user}`);
    }
  }
  next();
});

// Configure Socket.IO with better settings for video streaming
const io = new Server(server, {
  cors: {
    origin: function(origin, callback) {
      const allowedOrigins = ['https://mv-live.netlify.app', 'http://localhost:5173'];
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 1e8, // 100MB
});

// Routes
app.use("/auth", authRoutes)
app.use("/api/rooms", roomRoutes)
app.use("/api/users", userRoutes)

// Initialize Socket handlers AFTER defining routes
initializeSocketHandlers(io);

// Add a health check route for Vercel
app.get('/api/health', (req, res) => {
  // Check MongoDB connection
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    database: dbStatus
  });
});

// Improved error handling - all app code should come before this
app.use(errorHandler);

// Create async start function to ensure DB is connected first
const startServer = async () => {
  try {
    // Connect to MongoDB before starting the server
    await connectDB();
    
    // Fix for existing duplicate null inviteLink values by dropping the index
    try {
      // Check if the collection exists and has the index
      const collections = await mongoose.connection.db.listCollections({ name: 'rooms' }).toArray();
      
      if (collections.length > 0) {
        console.log("Attempting to fix inviteLink index issue...");
        
        // Get all indexes on the rooms collection
        const indexes = await mongoose.connection.db.collection('rooms').indexes();
        
        // Check if inviteLink_1 index exists
        const hasInviteLinkIndex = indexes.some(index => index.name === 'inviteLink_1');
        
        if (hasInviteLinkIndex) {
          console.log("Found inviteLink_1 index, dropping it...");
          await mongoose.connection.db.collection('rooms').dropIndex('inviteLink_1');
          console.log("Successfully dropped inviteLink_1 index");
        }
      }
    } catch (indexError) {
      console.error("Error handling inviteLink index:", indexError);
      // Continue anyway - we don't want to prevent server startup
    }
    
    const PORT = process.env.PORT || 5000;
    
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    });
    
    // Initialize Socket.io handlers after server is running
    initializeSocketHandlers(server);
    
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();

// Vercel serverless function handler
module.exports = app