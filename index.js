import http from "http";
import dotenv from "dotenv";
dotenv.config();
import { Server } from "socket.io";
import { connectDB, disconnectDB } from "./src/db/index.js";
import {
  connectRedisConfig,
  disconnectRedisConfig,
} from "./src/config/redis.config.js";
import { app } from "./app.js";
import { isOriginAllowed } from "./src/config/cors.config.js";
import { initializeSocket } from "./src/sockets/index.socket.js";
import { setIOInstance } from "./src/sockets/io.instance.js";
import {
  startPushNotificationWorker,
  stopPushNotificationWorker,
} from "./src/services/notification.service.js";
import {
  startJobRecoveryWorker,
  stopJobRecoveryWorker,
} from "./src/services/jobRecovery.service.js";

const PORT = process.env.PORT || 3000;
let isShuttingDown = false;

// Create HTTP server
const server = http.createServer(app);

// Attach Socket.IO
// const io = new Server(server, {
//   cors: {
//     origin: (origin, callback) => {
//       if (!origin || origin === "null") {
//         return callback(null, true);
//       }

//       if (allowedOrigins.includes(origin)) {
//         return callback(null, true);
//       }

//       return callback(new Error("CORS Error: Origin not allowed"));
//     },
//     credentials: true,
//     methods: ["GET", "POST"],
//   },
// });

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS Error: Origin not allowed"));
    },
    credentials: true,
    methods: ["GET", "POST"],
  },
});

setIOInstance(io);

initializeSocket(io);

export { io };

const closeHttpServer = () => new Promise((resolve) => server.close(resolve));

const shutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Received ${signal}. Starting graceful shutdown...`);

  try {
    io.close();
    await closeHttpServer();
    stopJobRecoveryWorker();
    await stopPushNotificationWorker();
    await disconnectRedisConfig();
    await disconnectDB();
    console.log("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("Graceful shutdown failed:", error);
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  shutdown("uncaughtException");
});

const startServer = async () => {
  await connectDB();
  await connectRedisConfig();
  startPushNotificationWorker();
  startJobRecoveryWorker();

  server.listen(PORT, () => {
    console.log(`🚀 Server running at PORT ${PORT}`);
  });
};

// DB + Redis + Server Start
startServer().catch((error) => {
  console.log("❌ MONGO DB connection failed:", error);
});
