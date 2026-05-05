const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/auth.route");
const userRoutes = require("./routes/user.route");
const chatRoutes = require("./routes/chat.route");
const { connectDB } = require("./lib/db");
require("dotenv").config();
const path = require("path");

const PORT = process.env.PORT || 8000;
const app = express();

// CORS configuration from environment variables
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(origin => origin.trim())
  : ["http://localhost:3000", "http://localhost:5173"];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes("*")) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  optionsSuccessStatus: 200
}));

app.use(cookieParser())
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);

if (process.env.MODE === "production") {
  app.use(express.static(path.join(__dirname, "../../frontend/dist")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../../frontend", "dist", "index.html"));
  });
}

app.listen(PORT, () => {
    console.log(`Server is started on port ${PORT}`);
    connectDB();
});
