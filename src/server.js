const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const { StreamChat } = require("stream-chat");

// Load environment variables
dotenv.config();

// Import routes and utilities
const authRoutes = require("./routes/auth.route");
const userRoutes = require("./routes/user.route");
const chatRoutes = require("./routes/chat.route");
const { connectDB } = require("./lib/db");
const { initializeStreamChat } = require("./lib/stream");

// Initialize Express app
const app = express();

// Environment variables
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const MONGO_URI = process.env.MONGO_URI;
const STREAM_API_KEY = process.env.STREAM_API_KEY;

// Setup allowed origins
const allowedOrigins = CLIENT_URL.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

allowedOrigins.push("https://chat-f-beta.vercel.app");

// CORS Configuration
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app")
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);

app.options("*", cors());

// Middleware
app.use(express.json({ limit: "1mb" }));

// Health Check Endpoints
app.get("/", (_req, res) => {
  res.json({ ok: true, message: "StackChat backend is running" });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mongoConfigured: Boolean(MONGO_URI),
    mongoConnected: mongoose.connection.readyState === 1,
    streamConfigured: Boolean(process.env.STREAM_API_KEY && process.env.STREAM_API_SECRET),
    streamApiKey: STREAM_API_KEY || null,
  });
});

// Route imports
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);

// Stream Chat Configuration Endpoints
app.get("/api/stream/config", (_req, res) => {
  if (!STREAM_API_KEY) {
    return res
      .status(500)
      .json({ message: "STREAM_API_KEY is missing from environment variables." });
  }
  res.json({ apiKey: STREAM_API_KEY });
});

app.get("/api/stream/verify", async (_req, res) => {
  try {
    const streamClient = initializeStreamChat();
    if (!streamClient) {
      return res.status(500).json({
        ok: false,
        apiKey: STREAM_API_KEY || null,
        message: "Stream Chat is not configured. Set STREAM_API_KEY and STREAM_API_SECRET.",
      });
    }

    await streamClient.upsertUser({
      id: "stackchat_config_check",
      name: "StackChat Config Check",
    });

    res.json({
      ok: true,
      apiKey: STREAM_API_KEY,
      message: "Stream API key and secret are valid.",
    });
  } catch (error) {
    console.error("Stream verification failed:", error);
    res.status(401).json({
      ok: false,
      apiKey: STREAM_API_KEY,
      message: `STREAM_API_SECRET does not match STREAM_API_KEY "${STREAM_API_KEY}".`,
    });
  }
});

// Error Handling Middleware
app.use((err, _req, res, _next) => {
  console.error("Server error:", err);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Start Server
async function startServer() {
  try {
    // Connect to MongoDB
    if (MONGO_URI) {
      await connectDB();
      console.log("MongoDB connected successfully");
    } else {
      console.warn("MONGO_URI not set, starting without MongoDB");
    }

    // Start listening
    app.listen(PORT, () => {
      console.log(`\n✓ Server running on http://localhost:${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`✓ CORS Origins: ${allowedOrigins.join(", ")}\n`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
