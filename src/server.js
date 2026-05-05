const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { StreamChat } = require("stream-chat");

let bcrypt = null;
try {
  bcrypt = require("bcryptjs");
} catch (_error) {
  bcrypt = null;
}

dotenv.config();

const app = express();

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const MONGO_URI = process.env.MONGO_URI;
const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || "stackchat_dev_secret_change_me";
const allowedOrigins = CLIENT_URL.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
allowedOrigins.push("https://chat-f-beta.vercel.app");

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
app.use(express.json({ limit: "1mb" }));

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      default: "",
      select: false,
    },
    password: {
      type: String,
      default: "",
      select: false,
    },
    profilePic: {
      type: String,
      default: "",
    },
    isOnboarded: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(password, savedHash) {
  if (!password || !savedHash || typeof savedHash !== "string") {
    return false;
  }

  if (savedHash.startsWith("$2")) {
    return bcrypt ? bcrypt.compareSync(password, savedHash) : false;
  }

  if (!savedHash.includes(":")) {
    return false;
  }

  const [salt, hash] = savedHash.split(":");
  if (!salt || !hash) return false;

  const incomingHash = hashPassword(password, salt).split(":")[1];

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(incomingHash, "hex")
  );
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signToken(payload) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    })
  );
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;

  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  ) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(body, "base64").toString("utf8"));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.split("=")[1]) : null;
}

function sendAuthCookie(res, token) {
  const isProduction = process.env.NODE_ENV === "production";

  res.cookie("jwt", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function serializeUser(user) {
  return {
    _id: user._id,
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    profilePic: user.profilePic,
    isOnboarded: user.isOnboarded,
  };
}

function requireMongo(res) {
  if (mongoose.connection.readyState === 1) return true;

  res.status(503).json({
    message: "Database is not connected. Check MONGO_URI in Render.",
  });

  return false;
}

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

app.post("/api/auth/signup", async (req, res) => {
  try {
    if (!requireMongo(res)) return;

    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        message: "fullName, email and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        message: "Email is already registered",
      });
    }

    const user = await User.create({
      fullName,
      email,
      passwordHash: hashPassword(password),
      profilePic: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(fullName)}`,
    });

    sendAuthCookie(res, signToken({ userId: user._id.toString() }));

    res.status(201).json(serializeUser(user));
  } catch (error) {
    console.error("Signup failed:", error);
    res.status(500).json({
      message: "Signup failed",
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    if (!requireMongo(res)) return;

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email }).select("+passwordHash +password");
    const savedPassword = user?.passwordHash || user?.password;

    if (!user || !verifyPassword(password, savedPassword)) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    sendAuthCookie(res, signToken({ userId: user._id.toString() }));

    res.json(serializeUser(user));
  } catch (error) {
    console.error("Login failed:", error);
    res.status(500).json({
      message: "Login failed",
    });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("jwt", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });

  res.json({
    message: "Logged out successfully",
  });
});

app.get("/api/auth/me", async (req, res) => {
  try {
    if (!requireMongo(res)) return;

    const token = getCookie(req, "jwt");
    const payload = verifyToken(token);

    if (!payload?.userId) {
      return res.status(401).json({
        message: "Not authenticated",
      });
    }

    const user = await User.findById(payload.userId);
    if (!user) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    res.json(serializeUser(user));
  } catch (error) {
    console.error("Auth check failed:", error);
    res.status(401).json({
      message: "Not authenticated",
    });
  }
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
