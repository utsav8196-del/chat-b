const express = require("express");
const { login, signup, logout, onboarding } = require("../controllers/auth.controller");
const { protectedRoute } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/onboarding", protectedRoute, onboarding);

// To check We have successfully logged in
router.get("/me", protectedRoute, (req, res) => {
    res.status(200).json({ success: true, user: req.user });// Return user data
})

module.exports = router;