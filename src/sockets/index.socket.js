// src/sockets/index.js

const initializeSocket = (io) => {

  /*
     This runs when a new client connects
  */
  io.on("connection", (socket) => {
    console.log("New Socket Connected:", socket.id);

    /*
       Example test event
       Client emits: "ping"
    */
    socket.on("ping", (data) => {
      console.log("Ping received:", data);

      socket.emit("pong", {
        message: "Connection successful",
      });
    });

    /*
       When client disconnects
    */
    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });

  });

};


export { initializeSocket };