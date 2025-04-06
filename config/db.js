const mongoose = require("mongoose");

// Store the MongoDB connection promise to reuse it
let cachedConnection = null;

const connectDB = async () => {
  // If we already have a connection, return it
  if (cachedConnection && mongoose.connection.readyState === 1) {
    console.log("🔄 Using existing MongoDB connection");
    return cachedConnection;
  }

  try {
    // Enhanced connection options for serverless environments
    const options = {
      // IMPORTANT: Allow buffering commands during initial connection
      // This should be set to true in serverless environments to prevent this exact error
      bufferCommands: true, 
      serverSelectionTimeoutMS: 15000, // Increase timeout for serverless environment
      socketTimeoutMS: 45000, // Keep alive socket longer
      maxPoolSize: 10, // Maintain up to 10 socket connections
      minPoolSize: 0, // Don't maintain any minimum number of connections
      ssl: true,  // Use SSL for connection
      replicaSet: process.env.MONGO_REPLICA_SET || 'atlas-qjuxp1-shard-0', // Use the replicaSet name found in your connection string
      authSource: 'admin', // Auth database
      retryWrites: true,
      tls: true,
      // Add these options to handle serverless environments better
      autoCreate: true,
      autoIndex: true,
      family: 4, // Use IPv4, avoids issues with some cloud providers
    };

    // Log that we're connecting
    console.log("🔄 Connecting to MongoDB Atlas...");
    
    if (!process.env.MONGO_URI) {
      throw new Error("MongoDB URI not defined in environment variables");
    }

    // Connect to MongoDB
    cachedConnection = await mongoose.connect(process.env.MONGO_URI, options);
    console.log("✅ MongoDB Atlas Connected...");
    
    // Add connection event handlers
    mongoose.connection.on('error', err => {
      console.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
      cachedConnection = null;
    });
    
    // Proper connection clean-up for development environments
    if (process.env.NODE_ENV !== 'production') {
      process.on('SIGINT', async () => {
        await mongoose.connection.close();
        console.log('MongoDB connection closed due to app termination');
        process.exit(0);
      });
    }
    
    return cachedConnection;
  } catch (error) {
    console.error("❌ MongoDB Atlas Connection Failed:", error.message);
    // Don't exit the process in serverless environment, just log the error
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
    throw error; // Re-throw to handle it in calling code
  }
};

// Connect to database early to fail fast if there's an issue
connectDB().catch(console.error);

module.exports = connectDB;