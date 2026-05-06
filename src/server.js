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

// Track online users: userId -> socketId
const onlineUsers = {};

// Store pending call info: callerId -> { targetUserId, callType, status: 'ringing' | 'accepted' }
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

  // Mark as online
  onlineUsers[socket.userId] = socket.id;
  io.emit("getOnlineUsers", Object.keys(onlineUsers));

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
      const receiverSocketId = onlineUsers[receiverId];
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("newMessage", message);
      }
      socket.emit("newMessage", message);
    } catch (err) {
      console.error("Message send error:", err);
      socket.emit("messageError", { error: "Could not send message" });
    }
  });

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

  // ===================== WEBRTC CALL SIGNALING =====================

  // Initiate a call (ringing)
  // socket.on("callUser", ({ targetUserId, callType }) => {
  //   const targetSocketId = onlineUsers[targetUserId];
  //   if (targetSocketId) {
  //     // Save pending call for this caller
  //     pendingCalls[socket.userId] = {
  //       targetUserId,
  //       callType,
  //       status: "ringing",
  //     };

  //     io.to(targetSocketId).emit("incomingCall", {
  //       from: socket.userId,
  //       fromName: socket.user.fullName,
  //       callType,
  //     });
  //     socket.emit("callRinging");
  //   } else {
  //     socket.emit("callFailed", { reason: "User is offline" });
  //   }
  // });

  // // Receiver accepts call
  // socket.on("acceptCall", ({ to }) => {
  //   const callerSocketId = onlineUsers[to];
  //   const pending = pendingCalls[to];

  //   if (pending) {
  //     pending.status = "accepted";
  //   }

  //   if (callerSocketId) {
  //     // Caller still online with same socket
  //     io.to(callerSocketId).emit("callAccepted", {
  //       from: socket.userId,
  //       fromName: socket.user.fullName,
  //     });
  //   }
  //   // If caller isn't online, they will pick it up via checkPendingCall when they reconnect
  // });

  // // Decline call
  // socket.on("declineCall", ({ to }) => {
  //   const callerSocketId = onlineUsers[to];
  //   delete pendingCalls[to];  // clean up
  //   if (callerSocketId) {
  //     io.to(callerSocketId).emit("callDeclined", {
  //       from: socket.userId,
  //       fromName: socket.user.fullName,
  //     });
  //   }
  // });

  // // End call
  // socket.on("callEnd", ({ to }) => {
  //   const targetSocketId = onlineUsers[to];
  //   delete pendingCalls[socket.userId];
  //   delete pendingCalls[to];
  //   if (targetSocketId) {
  //     io.to(targetSocketId).emit("callEnded");
  //   }
  // });

  // // ----- WebRTC offer / answer / ICE -----
  // socket.on("webrtc_offer", ({ to, offer }) => {
  //   const targetSocketId = onlineUsers[to];
  //   if (targetSocketId) {
  //     io.to(targetSocketId).emit("webrtc_offer", { from: socket.userId, offer });
  //   }
  // });

  // socket.on("webrtc_answer", ({ to, answer }) => {
  //   const targetSocketId = onlineUsers[to];
  //   if (targetSocketId) {
  //     io.to(targetSocketId).emit("webrtc_answer", { from: socket.userId, answer });
  //   }
  // });

  // socket.on("webrtc_ice_candidate", ({ to, candidate }) => {
  //   const targetSocketId = onlineUsers[to];
  //   if (targetSocketId) {
  //     io.to(targetSocketId).emit("webrtc_ice_candidate", { from: socket.userId, candidate });
  //   }
  // });

  // // When a caller reconnects (e.g., on CallPage), check if call was accepted
  // socket.on("checkPendingCall", () => {
  //   const pending = pendingCalls[socket.userId];
  //   if (pending && pending.status === "accepted") {
  //     socket.emit("callAccepted", {
  //       from: pending.targetUserId,
  //       fromName: "Friend",   // You could fetch the actual name if desired
  //     });
  //   }
  // });


  // Initiate a call
  socket.on("callUser", ({ targetUserId, callType }) => {
    const targetSocketId = onlineUsers[targetUserId];
    if (targetSocketId) {
      pendingCalls[socket.userId] = {
        targetUserId,
        callType,
        status: "ringing",
      };
      io.to(targetSocketId).emit("incomingCall", {
        from: socket.userId,
        fromName: socket.user.fullName,
        callType,
      });
      socket.emit("callRinging");
    } else {
      socket.emit("callFailed", { reason: "User is offline" });
    }
  });

  // Receiver accepts call
  socket.on("acceptCall", ({ to }) => {
    const callerSocketId = onlineUsers[to];
    const pending = pendingCalls[to];
    if (pending) pending.status = "accepted";

    if (callerSocketId) {
      io.to(callerSocketId).emit("callAccepted", {
        from: socket.userId,
        fromName: socket.user.fullName,
      });
    }
    // If caller has reconnected, they will pick it up via checkPendingCall
  });

  // Decline call
  socket.on("declineCall", ({ to }) => {
    const callerSocketId = onlineUsers[to];
    delete pendingCalls[to];
    if (callerSocketId) {
      io.to(callerSocketId).emit("callDeclined", {
        from: socket.userId,
        fromName: socket.user.fullName,
      });
    }
  });

  // End call
  socket.on("callEnd", ({ to }) => {
    const targetSocketId = onlineUsers[to];
    delete pendingCalls[socket.userId];
    delete pendingCalls[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit("callEnded");
    }
  });

  // WebRTC signaling
  socket.on("webrtc_offer", ({ to, offer }) => {
    const targetSocketId = onlineUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit("webrtc_offer", { from: socket.userId, offer });
    }
  });

  socket.on("webrtc_answer", ({ to, answer }) => {
    const targetSocketId = onlineUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit("webrtc_answer", { from: socket.userId, answer });
    }
  });

  socket.on("webrtc_ice_candidate", ({ to, candidate }) => {
    const targetSocketId = onlineUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit("webrtc_ice_candidate", { from: socket.userId, candidate });
    }
  });

  // When a user reconnects (e.g., on CallPage), check pending accepted calls
  socket.on("checkPendingCall", () => {
    const pending = pendingCalls[socket.userId];
    if (pending && pending.status === "accepted") {
      socket.emit("callAccepted", {
        from: pending.targetUserId,
        fromName: "Friend", // you could fetch actual name if desired
      });
    }
  });

  // ===================== DISCONNECT =====================
  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.userId);
    delete onlineUsers[socket.userId];
    io.emit("getOnlineUsers", Object.keys(onlineUsers));
    // Note: We do NOT delete pendingCalls on disconnect, because the caller may be reconnecting.
  });
});

// ---- START SERVER ----
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});