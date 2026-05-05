const { StreamChat } = require("stream-chat");
require("dotenv").config();

const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;

let streamClient = null;

const initializeStreamChat = () => {
  if (streamClient) return streamClient;

  if (!STREAM_API_KEY || !STREAM_API_SECRET) {
    console.warn(
      "Stream Chat is not configured. Set STREAM_API_KEY and STREAM_API_SECRET."
    );
    return null;
  }

  try {
    streamClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_API_SECRET);
    return streamClient;
  } catch (error) {
    console.error("Failed to initialize Stream Chat:", error.message);
    return null;
  }
};

const upsertStreamUser = async (userData) => {
  try {
    const client = initializeStreamChat();
    if (!client) {
      throw new Error("Stream Chat client not initialized");
    }
    await client.upsertUsers([userData]);
    return userData;
  } catch (error) {
    console.error("Error upserting Stream user:", error.message);
    throw error;
  }
};

const generateStreamToken = (userId) => {
  try {
    const client = initializeStreamChat();
    if (!client) {
      throw new Error("Stream Chat client not initialized");
    }
    const userIdStr = userId.toString();
    return client.createToken(userIdStr);
  } catch (error) {
    console.error("Error generating Stream token:", error.message);
    throw error;
  }
};

module.exports = {
  initializeStreamChat,
  upsertStreamUser,
  generateStreamToken,
};