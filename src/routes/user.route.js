const express = require("express");
const { protectedRoute } = require("../middleware/auth.middleware");

const {
    acceptFriendRequest,
    getFriendRequests,
    getMyFriends,
    getOutgoingFriendReqs,
    getRecommendedUsers,
    sendFriendRequest,
    declineFriendRequest, 
} = require("../controllers/user.controller");

const router = express.Router();

// applying auth middleware to all routes
router.use(protectedRoute);

router.get("/", getRecommendedUsers);
router.get("/friends", getMyFriends);

router.post("/friend-request/:id", sendFriendRequest);
router.put("/friend-request/:id/accept", acceptFriendRequest);

router.get("/friend-requests", getFriendRequests);
router.get("/outgoing-friend-requests", getOutgoingFriendReqs);
router.delete("/friend-request/:id/decline", declineFriendRequest);
module.exports = router;