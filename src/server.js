// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const cookie = require("cookie");

// Route imports
const authRoutes = require("./routes/auth.route");
const userRoutes = require("./routes/user.route");
const chatRoutes = require("./routes/chat.route");   // for Stream token (if you still need it)

// Models
const Message = require("./models/Message");
const User = require("./models/User");

const app = express();
const server = http.createServer(app);

// ---- MIDDLEWARE ----
app.use(express.json());
app.use(cookieParser());

// Parse ALLOWED_ORIGINS from env
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// ---- DATABASE ----
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("MongoDB connection error:", err));

// ---- ROUTES ----
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);

// ---- MESSAGE REST API ----
app.post("/api/messages", async (req, res) => {
  try {
    const { senderId, receiverId, text } = req.body;
    if (!senderId || !receiverId || !text)
      return res.status(400).json({ message: "Missing fields" });
    const msg = await Message.create({ senderId, receiverId, text });
    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/messages/:user1/:user2", async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const messages = await Message.find({
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 },
      ],
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- SOCKET.IO SETUP ----
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// Track online users: userId -> Set of socket IDs
const userSockets = {};

// Store pending call info: callerId -> { targetUserId, callType, status }
const pendingCalls = {};

// Socket.IO authentication – read httpOnly cookie
io.use(async (socket, next) => {
  try {
    const rawCookies = socket.handshake.headers.cookie;
    if (!rawCookies) return next(new Error("No cookies"));
    const parsed = cookie.parse(rawCookies);
    const token = parsed.token;
    if (!token) return next(new Error("No token cookie"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) return next(new Error("User not found"));

    socket.userId = user._id.toString();
    socket.user = user;
    next();
  } catch (err) {
    next(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.userId);

  // Add to userSockets set
  if (!userSockets[socket.userId]) userSockets[socket.userId] = new Set();
  userSockets[socket.userId].add(socket.id);

  // Notify all clients of updated online list
  io.emit("getOnlineUsers", Object.keys(userSockets));

  // Join personal room
  socket.join(socket.userId);

  // ===================== CHAT MESSAGING =====================
  socket.on("sendMessage", async ({ receiverId, text }) => {
    try {
      const message = await Message.create({
        senderId: socket.userId,
        receiverId,
        text,
      });
      // Send to all sockets of receiver
      if (userSockets[receiverId]) {
        userSockets[receiverId].forEach(sid => {
          io.to(sid).emit("newMessage", message);
        });
      }
      // Send back to all sockets of sender (for sync across tabs)
      if (userSockets[socket.userId]) {
        userSockets[socket.userId].forEach(sid => {
          io.to(sid).emit("newMessage", message);
        });
      }
    } catch (err) {
      console.error("Message send error:", err);
      socket.emit("messageError", { error: "Could not send message" });
    }
  });

  socket.on("typing", (receiverId) => {
    if (userSockets[receiverId]) {
      userSockets[receiverId].forEach(sid => {
        io.to(sid).emit("userTyping", { userId: socket.userId, name: socket.user.fullName });
      });
    }
  });

  socket.on("stopTyping", (receiverId) => {
    if (userSockets[receiverId]) {
      userSockets[receiverId].forEach(sid => {
        io.to(sid).emit("userStopTyping", socket.userId);
      });
    }
  });

  // ===================== WEBRTC CALL SIGNALING =====================
  socket.on("callUser", ({ targetUserId, callType }) => {
    const targetSockets = userSockets[targetUserId];
    if (targetSockets && targetSockets.size > 0) {
      pendingCalls[socket.userId] = { targetUserId, callType, status: "ringing" };
      targetSockets.forEach(sid => {
        io.to(sid).emit("incomingCall", {
          from: socket.userId,
          fromName: socket.user.fullName,
          callType,
        });
      });
      socket.emit("callRinging");
    } else {
      socket.emit("callFailed", { reason: "User is offline" });
    }
  });

  socket.on("acceptCall", ({ to }) => {
    const callerSockets = userSockets[to];
    const pending = pendingCalls[to];
    if (pending) pending.status = "accepted";
    if (callerSockets) {
      callerSockets.forEach(sid => {
        io.to(sid).emit("callAccepted", { from: socket.userId, fromName: socket.user.fullName });
      });
    }
  });

  socket.on("declineCall", ({ to }) => {
    const callerSockets = userSockets[to];
    delete pendingCalls[to];
    if (callerSockets) {
      callerSockets.forEach(sid => {
        io.to(sid).emit("callDeclined", { from: socket.userId, fromName: socket.user.fullName });
      });
    }
  });

  socket.on("callEnd", ({ to }) => {
    const targetSockets = userSockets[to];
    delete pendingCalls[socket.userId];
    delete pendingCalls[to];
    if (targetSockets) {
      targetSockets.forEach(sid => io.to(sid).emit("callEnded"));
    }
  });

  // WebRTC signaling
  socket.on("webrtc_offer", ({ to, offer }) => {
    if (userSockets[to]) {
      userSockets[to].forEach(sid => io.to(sid).emit("webrtc_offer", { from: socket.userId, offer }));
    }
  });
  socket.on("webrtc_answer", ({ to, answer }) => {
    if (userSockets[to]) {
      userSockets[to].forEach(sid => io.to(sid).emit("webrtc_answer", { from: socket.userId, answer }));
    }
  });
  socket.on("webrtc_ice_candidate", ({ to, candidate }) => {
    if (userSockets[to]) {
      userSockets[to].forEach(sid => io.to(sid).emit("webrtc_ice_candidate", { from: socket.userId, candidate }));
    }
  });

  socket.on("checkPendingCall", () => {
    const pending = pendingCalls[socket.userId];
    if (pending && pending.status === "accepted") {
      // Re-send acceptance to all sockets of this caller
      if (userSockets[socket.userId]) {
        userSockets[socket.userId].forEach(sid => {
          io.to(sid).emit("callAccepted", { from: pending.targetUserId, fromName: "Friend" });
        });
      }
    }
  });

  // ===================== DISCONNECT =====================
  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.userId);
    if (userSockets[socket.userId]) {
      userSockets[socket.userId].delete(socket.id);
      if (userSockets[socket.userId].size === 0) {
        delete userSockets[socket.userId];
      }
    }
    io.emit("getOnlineUsers", Object.keys(userSockets));
  });
});

// ---- MAKE io AND userSockets AVAILABLE TO ROUTES ----
app.use((req, res, next) => {
  req.io = io;
  req.userSockets = userSockets;
  next();
});

// ---- START SERVER ----
const PORT = parseInt(process.env.PORT, 10) || 8000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});