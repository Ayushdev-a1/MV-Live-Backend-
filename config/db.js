const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // Enhanced connection options for serverless environments
    const options = {
      // Remove deprecated options
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
      
      // Add options important for serverless
      bufferCommands: false, // Disable mongoose buffering
      serverSelectionTimeoutMS: 10000, // Reduce the server selection timeout for faster failure
      socketTimeoutMS: 45000, // Keep alive socket longer
      maxPoolSize: 10, // Maintain up to 10 socket connections
      minPoolSize: 0, // Don't maintain any minimum number of connections
      ssl: true,  // Use SSL for connection
      replicaSet: process.env.MONGO_REPLICA_SET || 'atlas-qjuxp1-shard-0', // Use the replicaSet name found in your connection string
      authSource: 'admin', // Auth database
      retryWrites: true,
      tls: true,
    };

    // Log that we're connecting
    console.log("🔄 Connecting to MongoDB Atlas...");
    
    if (!process.env.MONGO_URI) {
      throw new Error("MongoDB URI not defined in environment variables");
    }

    await mongoose.connect(process.env.MONGO_URI, options);
    console.log("✅ MongoDB Atlas Connected...");
  } catch (error) {
    console.error("❌ MongoDB Atlas Connection Failed:", error.message);
    // Don't exit the process in serverless environment, just log the error
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  }
};

// Connect to database early to fail fast if there's an issue
connectDB().catch(console.error);

module.exports = connectDB;