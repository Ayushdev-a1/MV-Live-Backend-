const mongoose = require("mongoose");

let cachedConnection = null;

const connectDB = async () => {
  if (cachedConnection && mongoose.connection.readyState === 1) {
    console.log("🔄 Using existing MongoDB connection");
    return cachedConnection;
  }

  try {
    const uri = process.env.MONGO_URI;
    console.log("MONGO_URI:", uri); // Debug log

    if (!uri) {
      throw new Error("MongoDB URI not defined in environment variables");
    }

    // Extract replicaSet from URI if possible
    const replicaSetMatch = uri.match(/replicaSet=([^&]+)/);
    const replicaSet = replicaSetMatch ? replicaSetMatch[1] : 'atlas-qjuxp1-shard-0';

    const options = {
      bufferCommands: true,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 15000,
      maxPoolSize: 5,
      minPoolSize: 0,
      ssl: true,
      tls: true,
      replicaSet: replicaSet,
      authSource: 'admin',
      retryWrites: true,
      autoCreate: true,
      autoIndex: true,
      family: 4,
    };

    console.log("🔄 Connecting to MongoDB Atlas...");
    cachedConnection = await mongoose.connect(uri, options);
    console.log("✅ MongoDB Atlas Connected...");

    mongoose.connection.on('error', err => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
      cachedConnection = null;
    });

    if (process.env.NODE_ENV !== 'production') {
      process.on('SIGINT', async () => {
        await mongoose.connection.close();
        console.log('MongoDB connection closed due to app termination');
        process.exit(0);
      });
    }

    return cachedConnection;
  } catch (error) {
    console.error("❌ MongoDB Atlas Connection Failed:", {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: error.code,
    });
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
    throw error;
  }
};

connectDB().catch(console.error);

module.exports = connectDB;