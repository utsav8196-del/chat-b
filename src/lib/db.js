const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI)
        console.log("MongoDB Connected",conn.connection.host);
    } catch (error) {
        console.error("Error in connecting with MongoDB ",error);
        process.exit(1); // 1 means failure
    }
}

module.exports = { connectDB }