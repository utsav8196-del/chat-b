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
const chatRoutes = require("./routes/chat.route");   // for Stream token if needed

// Models
const Message = require("./models/Message");
const User = require("./models/User");

const app = express();
const server = http.createServer(app);

// ---- MIDDLEWARE ----
app.use(express.json());
app.use(cookieParser());

// Parse ALLOWED_ORIGINS
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
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

// ---- MESSAGE API (REST) ----
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

// Track online users: userId -> socketId
const onlineUsers = {};

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

  // Mark as online
  onlineUsers[socket.userId] = socket.id;
  io.emit("getOnlineUsers", Object.keys(onlineUsers));

  // Join a personal room (optional, for future features)
  socket.join(socket.userId);

  // Handle private message
  socket.on("sendMessage", async ({ receiverId, text }) => {
    try {
      const message = await Message.create({
        senderId: socket.userId,
        receiverId,
        text,
      });

      // Send to receiver if online
      const receiverSocketId = onlineUsers[receiverId];
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("newMessage", message);
      }
      // Send back to sender for immediate display
      socket.emit("newMessage", message);
    } catch (err) {
      console.error("Message send error:", err);
      socket.emit("messageError", { error: "Could not send message" });
    }
  });

  // Typing indicators
  socket.on("typing", (receiverId) => {
    const receiverSocketId = onlineUsers[receiverId];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("userTyping", {
        userId: socket.userId,
        name: socket.user.fullName,
      });
    }
  });

  socket.on("stopTyping", (receiverId) => {
    const receiverSocketId = onlineUsers[receiverId];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("userStopTyping", socket.userId);
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.userId);
    delete onlineUsers[socket.userId];
    io.emit("getOnlineUsers", Object.keys(onlineUsers));
  });
});

// ---- START ----
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});