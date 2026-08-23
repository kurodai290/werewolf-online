const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  transports: ["polling", "websocket"],
  cors: { origin: true, methods: ["GET", "POST"], credentials: true }
});

const PORT = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");

app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(publicDir));

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "werewolf-online",
    socketio: true,
    time: new Date().toISOString()
  });
});

io.on("connection", socket => {
  console.log(`[Socket.IO] connected ${socket.id} transport=${socket.conn.transport.name}`);
  socket.on("disconnect", reason => {
    console.log(`[Socket.IO] disconnected ${socket.id} reason=${reason}`);
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Werewolf Online listening on 0.0.0.0:${PORT}`);
});
