const User = require("../models/User");

exports.protect = async (req, res, next) => {
  const googleId = req.headers.authorization; // Assuming you send Google ID in the header
  console.log(googleId)
  if (!googleId) {
    console.log("nhi aya h re baba")
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route",
    });
  }

  try {
    // Check if user exists with the provided Google ID
    const user = await User.findOne({ googleId });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User  no longer exists",
      });
    }

    req.user = {
      id: user.id, // Use Google ID
      username: user.name, // Assuming you have a name field
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route",
    });
  }
};