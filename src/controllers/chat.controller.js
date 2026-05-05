const { generateStreamToken, upsertStreamUser } = require("../lib/stream");
const User = require("../models/User");

async function getStreamToken(req, res) {
    try {
        // Ensure the current user exists in Stream
        await upsertStreamUser({
            id: req.user._id.toString(),
            name: req.user.fullName,
            image: req.user.profilePic || "",
        });

        // If chatting with a target user, ensure they exist in Stream too
        const { chatWith } = req.query;
        if (chatWith) {
            const targetUser = await User.findById(chatWith);
            if (!targetUser) {
                return res.status(404).json({ message: "Target user not found" });
            }

            await upsertStreamUser({
                id: targetUser._id.toString(),
                name: targetUser.fullName,
                image: targetUser.profilePic || "",
            });
        }

        const token = generateStreamToken(req.user.id);

        res.status(200).json({ token });
    } catch (error) {
        console.log("Error in getStreamToken controller:", error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
}

module.exports = { getStreamToken };