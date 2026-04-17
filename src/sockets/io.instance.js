let ioInstance = null;

const setIOInstance = (io) => {
  ioInstance = io;
};

const getIOInstance = () => {
  if (!ioInstance) {
    throw new Error("Socket.IO is not initialized");
  }
  return ioInstance;
};

export { setIOInstance, getIOInstance };
