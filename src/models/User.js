const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = mongoose.Schema(
    {
        fullName: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
        },
        password: {
            type: String,
            required: true,
            minlength: 8,
        },
        bio: {
            type: String,
            default: "",
        },
        profilePic: {
            type: String,
            default: "",
        },
        location: {
            type: String,
            default: "",
        },
        isOnboarded: {
            type: Boolean,
            default: false,
        },
        friends: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
            },
        ],
    },
    { timestamps: true } // to use for createAt, updatedAt likewise fields
);

// pre hook - Before saving the users to the database, we have to hash the passwords
// Password Hashing
// First we have to apply pre hook on userSchema then create a model
userSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return next(); // While updating other values, if password is not modified then directly go to the next middleware, do not need to hash the password again

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Instace Method
userSchema.methods.matchPassword = async function (enteredPassword) {
    const isPasswordCorrect = await bcrypt.compare(enteredPassword, this.password)
    return isPasswordCorrect;
}

// Static Method - For static methods, we use the model name - Model level Methods
userSchema.statics.findByEmail = async function (enteredEmail) {
    return await this.findOne({ email: enteredEmail })
}

const User = mongoose.model("User", userSchema);

module.exports = User;