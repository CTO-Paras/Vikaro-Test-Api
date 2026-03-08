import http from "http";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { connectDB } from "./src/db/index.js";
import { connectRedisConfig } from "./src/config/redis.config.js";
import { app } from "./app.js";
import { allowedOrigins } from "./src/config/cors.config.js";
import { initializeSocket } from "./src/sockets/index.socket.js";

dotenv.config({
  path: "./.env",
});

const PORT = process.env.LOCAL_PORT || 8000;

// Create HTTP server
const server = http.createServer(app);

// Attach Socket.IO
const io = new Server(server, {
  // cors: {
  //   origin: (origin, callback) => {
  //     if (!origin || origin === "null") {
  //       return callback(null, true);
  //     }

  //     if (allowedOrigins.includes(origin)) {
  //       return callback(null, true);
  //     }

  //     return callback(new Error("CORS Error: Origin not allowed"));
  //   },
  //   credentials: true,
  //   methods: ["GET", "POST"],
  // },

  cors: {
    origin: "*",
    credentials: true,
    methods: ["GET", "POST"],
  },
});


initializeSocket(io);

export { io };

// DB + Redis + Server Start
connectDB()
  .then(async () => {
    await connectRedisConfig();

    server.listen(PORT, () => {
      console.log(`🚀 Server running at PORT ${PORT}`);
    });
  })
  .catch((error) => {
    console.log("❌ MONGO DB connection failed:", error);
  });