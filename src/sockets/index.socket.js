import {
  authenticateFreelancerSocketService,
  registerFreelancerSocketEventsService,
} from "../services/socket.service.js";

const initializeSocket = (io) => {
  io.use(authenticateFreelancerSocketService);
  io.on("connection", registerFreelancerSocketEventsService);
};

export { initializeSocket };