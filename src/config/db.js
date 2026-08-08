import mongoose from "mongoose";
import dns from "dns";


dns.setServers(["8.8.8.8", "1.1.1.1"]);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || "");
    console.log(`[MongoDB] Connected to Host: ${conn.connection.host}`);
  } catch (error) {
    console.error("[MongoDB] Connection Error:", error);
    process.exit(1);
  }
};

export default connectDB