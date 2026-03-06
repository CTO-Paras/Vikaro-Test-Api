// src/services/socket.service.js

import { io } from "../../index.js";

/* -----------------------------------------
   🔔 Emit New Job To Freelancer
------------------------------------------ */
const emitNewJobToFreelancer = (freelancerId, job) => {
  io.to(`freelancer_${freelancerId}`).emit("newJob", job);
};

/* -----------------------------------------
   ✅ Notify Customer Job Accepted
------------------------------------------ */
const notifyCustomerJobAccepted = (customerId, job) => {
  io.to(`customer_${customerId}`).emit("jobAccepted", job);
};

/* -----------------------------------------
   ✅ Notify Freelancer Job Accepted
------------------------------------------ */
const notifyFreelancerJobAccepted = (freelancerId, job) => {
  io.to(`freelancer_${freelancerId}`).emit("jobAccepted", job);
};

/* -----------------------------------------
   ❌ Notify Job Expired
------------------------------------------ */
const notifyJobExpired = (customerId, jobId) => {
  io.to(`customer_${customerId}`).emit("jobExpired", { jobId });
};

/* -----------------------------------------
   🏠 Join Private Job Room
------------------------------------------ */
const joinJobRoom = (socket, jobId) => {
  socket.join(`room_${jobId}`);
};

export {
  emitNewJobToFreelancer,
  notifyCustomerJobAccepted,
  notifyFreelancerJobAccepted,
  notifyJobExpired,
  joinJobRoom,
};