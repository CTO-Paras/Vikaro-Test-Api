// src/sockets/index.socket.js

import { ProfileFreelancer } from "../models/profileFreelancer.model.js";

const onlineFreelancers = new Map(); 
// freelancerId -> socketId

const initializeSocket = (io) => {

  io.on("connection", (socket) => {
    console.log("🔌 New Socket Connected:", socket.id);

    /* -----------------------------------------
       🟢 FREELANCER GOES ONLINE
    ------------------------------------------ */
    socket.on("freelancerOnline", async ({ freelancerId, coordinates }) => {
      try {
        if (!freelancerId || !coordinates || coordinates.length !== 2) return;

        onlineFreelancers.set(freelancerId, socket.id);

        socket.join(`freelancer_${freelancerId}`);

        await ProfileFreelancer.findByIdAndUpdate(freelancerId, {
          status: "online",
          location: {
            type: "Point",
            coordinates, // [lng, lat]
          },
        });

        console.log(`🟢 Freelancer ${freelancerId} ONLINE`);
      } catch (error) {
        console.error("freelancerOnline error:", error);
      }
    });

    /* -----------------------------------------
       📍 LIVE GPS UPDATE (Every 20-30 sec)
    ------------------------------------------ */
    socket.on("updateLocation", async ({ freelancerId, coordinates }) => {
      try {
        if (!freelancerId || !coordinates || coordinates.length !== 2) return;

        await ProfileFreelancer.findByIdAndUpdate(freelancerId, {
          location: {
            type: "Point",
            coordinates,
          },
        });

        console.log(`📍 Location updated for ${freelancerId}`);
      } catch (error) {
        console.error("updateLocation error:", error);
      }
    });

    /* -----------------------------------------
       🟢 CUSTOMER JOINS ROOM
    ------------------------------------------ */
    socket.on("customerOnline", ({ customerId }) => {
      if (!customerId) return;

      socket.join(`customer_${customerId}`);
      console.log(`🟢 Customer ${customerId} joined room`);
    });

    /* -----------------------------------------
       🏠 JOIN PRIVATE JOB ROOM
    ------------------------------------------ */
    socket.on("joinJobRoom", ({ jobId }) => {
      if (!jobId) return;

      socket.join(`room_${jobId}`);
      console.log(`🏠 Joined room room_${jobId}`);
    });

    /* -----------------------------------------
       🔴 DISCONNECT HANDLING
    ------------------------------------------ */
    socket.on("disconnect", async () => {
      try {
        let freelancerToRemove = null;

        for (let [freelancerId, socketId] of onlineFreelancers.entries()) {
          if (socketId === socket.id) {
            freelancerToRemove = freelancerId;
            break;
          }
        }

        if (freelancerToRemove) {
          onlineFreelancers.delete(freelancerToRemove);

          await ProfileFreelancer.findByIdAndUpdate(freelancerToRemove, {
            status: "offline",
          });

          console.log(`🔴 Freelancer ${freelancerToRemove} OFFLINE`);
        }

      } catch (error) {
        console.error("disconnect error:", error);
      }

      console.log("❌ Socket disconnected:", socket.id);
    });

  });
};

export { initializeSocket };