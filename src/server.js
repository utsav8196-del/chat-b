const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const { StreamChat } = require("stream-chat");

dotenv.config();

const app = express();

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const MONGO_URI = process.env.MONGO_URI;
const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;
const allowedOrigins = CLIENT_URL.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

let streamServerClient = null;

if (STREAM_API_KEY && STREAM_API_SECRET) {
  streamServerClient = StreamChat.getInstance(
    STREAM_API_KEY,
    STREAM_API_SECRET
  );
} else {
  console.warn(
    "Stream Chat is not configured. Set STREAM_API_KEY and STREAM_API_SECRET in environment variables."
  );
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "StackChat backend is running",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mongoConfigured: Boolean(MONGO_URI),
    mongoConnected: mongoose.connection.readyState === 1,
    streamConfigured: Boolean(streamServerClient),
    streamApiKey: STREAM_API_KEY || null,
  });
});

app.get("/api/stream/config", (_req, res) => {
  if (!STREAM_API_KEY) {
    return res.status(500).json({
      message: "STREAM_API_KEY is missing from backend environment variables.",
    });
  }

  res.json({
    apiKey: STREAM_API_KEY,
  });
});

app.get("/api/stream/verify", async (_req, res) => {
  try {
    if (!streamServerClient) {
      return res.status(500).json({
        ok: false,
        apiKey: STREAM_API_KEY || null,
        message:
          "Stream Chat is not configured. Set STREAM_API_KEY and STREAM_API_SECRET in Render environment variables.",
      });
    }

    await streamServerClient.upsertUser({
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

app.post("/api/stream/token", async (req, res) => {
  try {
    if (!streamServerClient) {
      return res.status(500).json({
        message:
          "Stream Chat is not configured. Set STREAM_API_KEY and STREAM_API_SECRET in Render environment variables.",
      });
    }

    const { userId, name, image } = req.body;

    if (!userId || typeof userId !== "string") {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const safeUserId = userId.trim().replace(/[^a-zA-Z0-9@_-]/g, "_");
    const displayName = name?.trim() || safeUserId;

    const user = {
      id: safeUserId,
      name: displayName,
      image:
        image ||
        `https://getstream.io/random_png/?name=${encodeURIComponent(displayName)}`,
    };

    await streamServerClient.upsertUser(user);

    const token = streamServerClient.createToken(safeUserId);

    res.json({
      apiKey: STREAM_API_KEY,
      token,
      user,
    });
  } catch (error) {
    console.error("Stream token creation failed:", error);
    res.status(500).json({
      message: `Unable to create Stream token. Confirm STREAM_API_SECRET belongs to STREAM_API_KEY "${STREAM_API_KEY}".`,
    });
  }
});

app.post("/api/chat/token", async (req, res) => {
  try {
    if (!streamServerClient) {
      return res.status(500).json({
        message:
          "Stream Chat is not configured. Set STREAM_API_KEY and STREAM_API_SECRET in Render environment variables.",
      });
    }

    const { userId, name, image } = req.body;

    if (!userId || typeof userId !== "string") {
      return res.status(400).json({
        message: "userId is required",
      });
    }

    const safeUserId = userId.trim().replace(/[^a-zA-Z0-9@_-]/g, "_");
    const displayName = name?.trim() || safeUserId;

    const user = {
      id: safeUserId,
      name: displayName,
      image:
        image ||
        `https://getstream.io/random_png/?name=${encodeURIComponent(displayName)}`,
    };

    await streamServerClient.upsertUser(user);

    res.json({
      apiKey: STREAM_API_KEY,
      token: streamServerClient.createToken(safeUserId),
      user,
    });
  } catch (error) {
    console.error("Chat token creation failed:", error);
    res.status(500).json({
      message: `Unable to create chat token. Confirm STREAM_API_SECRET belongs to STREAM_API_KEY "${STREAM_API_KEY}".`,
    });
  }
});

app.post("/api/stream/channel", async (req, res) => {
  try {
    if (!streamServerClient) {
      return res.status(500).json({
        message:
          "Stream Chat is not configured. Set STREAM_API_KEY and STREAM_API_SECRET in Render environment variables.",
      });
    }

    const {
      channelId = "general",
      name = "General",
      userIds = [],
    } = req.body;

    const members = userIds
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => id.trim().replace(/[^a-zA-Z0-9@_-]/g, "_"));

    const channel = streamServerClient.channel("messaging", channelId, {
      name,
      members,
      created_by_id: members[0] || "stackchat_config_check",
    });

    await channel.create();

    res.json({
      ok: true,
      channelId,
    });
  } catch (error) {
    console.error("Stream channel creation failed:", error);
    res.status(500).json({
      message: "Unable to create Stream channel",
    });
  }
});

async function startServer() {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  if (MONGO_URI) {
    try {
      await mongoose.connect(MONGO_URI);
      console.log("MongoDB connected");
    } catch (error) {
      console.error("MongoDB connection failed:", error.message);
      console.log("Server is still running without MongoDB connection");
    }
  } else {
    console.log("MONGO_URI not set, starting without MongoDB");
  }
}

startServer();
