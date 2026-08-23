const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  transports: ["polling", "websocket"],
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const rooms = new Map();
const MAX = 10;

const ROLES = {
  5: ["人狼","占い師","騎士","村人","村人"],
  6: ["人狼","人狼","占い師","騎士","村人","村人"],
  7: ["人狼","人狼","占い師","騎士","霊媒師","村人","村人"],
  8: ["人狼","人狼","占い師","騎士","霊媒師","村人","村人"],
  9: ["人狼","人狼","人狼","占い師","騎士","霊媒師","村人","村人","村人"],
  10:["人狼","人狼","人狼","占い師","騎士","霊媒師","村人","村人","村人","村人"]
};

const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);

function makeCode() {
  let c;
  do {
    c = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(c));
  return c;
}

function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    host: p.host
  }));
}

function update(room) {
  io.to(room.code).emit("room:update", {
    code: room.code,
    phase: room.phase,
    day: room.day,
    players: publicPlayers(room),
    started: room.started,
    winner: room.winner
  });
}

function winner(room) {
  const alive = room.players.filter(p => p.alive);
  const wolves = alive.filter(p => p.role === "人狼").length;
  if (wolves === 0) return "村人陣営";
  if (wolves >= alive.length - wolves) return "人狼陣営";
  return null;
}

function beginNight(room) {
  room.phase = "night";
  room.day++;
  room.votes = {};
  room.night = { wolf: null, seer: null, guard: null };

  room.players.forEach(p => {
    if (p.alive) {
      p.socket.emit("game:role", {
        role: p.role,
        teammateIds: room.players
          .filter(x => x.role === "人狼" && x.id !== p.id)
          .map(x => x.id)
      });
    }
  });

  update(room);
}

function resolveNight(room) {
  if (room.night.wolf && room.night.guard !== room.night.wolf) {
    const target = room.players.find(p => p.id === room.night.wolf);
    if (target) target.alive = false;
  }

  const w = winner(room);
  if (w) {
    room.winner = w;
    room.phase = "finished";
  } else {
    room.phase = "day";
    room.votes = {};
  }

  update(room);
}

function allNightActionsDone(room) {
  const alive = room.players.filter(p => p.alive);
  const hasWolf = alive.some(p => p.role === "人狼");
  const hasSeer = alive.some(p => p.role === "占い師");
  const hasGuard = alive.some(p => p.role === "騎士");

  return (!hasWolf || !!room.night.wolf) &&
         (!hasSeer || !!room.night.seer) &&
         (!hasGuard || !!room.night.guard);
}

app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "werewolf-online",
    socketio: true,
    port: PORT,
    time: new Date().toISOString()
  });
});

io.on("connection", socket => {
  console.log(`[Socket.IO] connected ${socket.id} transport=${socket.conn.transport.name}`);

  socket.on("room:create", ({ name } = {}) => {
    name = String(name || "").trim().slice(0, 12);
    if (!name) return socket.emit("error:msg", "名前を入力してください。");

    const code = makeCode();
    const room = {
      code,
      players: [],
      started: false,
      phase: "lobby",
      day: 0,
      votes: {},
      night: {},
      winner: null
    };

    room.players.push({
      id: socket.id,
      socket,
      name,
      host: true,
      alive: true,
      role: null
    });

    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;

    socket.emit("room:joined", { code });
    update(room);
  });

  socket.on("room:join", ({ code, name } = {}) => {
    code = String(code || "").trim().toUpperCase();
    name = String(name || "").trim().slice(0, 12);

    const room = rooms.get(code);

    if (!name) return socket.emit("error:msg", "名前を入力してください。");
    if (!room) return socket.emit("error:msg", "そのルームはありません。");
    if (room.started) return socket.emit("error:msg", "ゲームはすでに始まっています。");
    if (room.players.length >= MAX) return socket.emit("error:msg", "満員です。");

    if (room.players.some(p => p.name === name)) {
      return socket.emit("error:msg", "その名前はすでに使われています。");
    }

    room.players.push({
      id: socket.id,
      socket,
      name,
      host: false,
      alive: true,
      role: null
    });

    socket.join(code);
    socket.data.room = code;

    socket.emit("room:joined", { code });
    update(room);
  });

  socket.on("game:start", () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;

    const me = room.players.find(p => p.id === socket.id);
    if (!me?.host) return socket.emit("error:msg", "ホストだけが開始できます。");
    if (room.players.length < 5) return socket.emit("error:msg", "5人以上で開始してください。");

    const roles = ROLES[room.players.length];
    shuffle(room.players).forEach((p, i) => {
      p.role = roles[i];
      p.alive = true;
    });

    room.started = true;
    room.winner = null;
    room.day = 0;

    beginNight(room);
  });

  socket.on("action:night", ({ action, targetId } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.phase !== "night") return;

    const me = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === targetId);

    if (!me?.alive || !target?.alive || target.id === me.id) return;

    if (action === "wolf" && me.role === "人狼") {
      room.night.wolf = target.id;
    }

    if (action === "seer" && me.role === "占い師") {
      socket.emit("action:result", {
        text: `${target.name}さんは${target.role === "人狼" ? "人狼" : "人狼ではありません"}。`
      });
      room.night.seer = target.id;
    }

    if (action === "guard" && me.role === "騎士") {
      room.night.guard = target.id;
    }

    if (allNightActionsDone(room)) {
      resolveNight(room);
    }
  });

  socket.on("action:vote", ({ targetId } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.phase !== "day") return;

    const me = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === targetId);

    if (!me?.alive || !target?.alive || target.id === me.id) return;

    room.votes[me.id] = target.id;

    const alive = room.players.filter(p => p.alive);
    if (Object.keys(room.votes).length < alive.length) return;

    const counts = {};
    Object.values(room.votes).forEach(id => {
      counts[id] = (counts[id] || 0) + 1;
    });

    const max = Math.max(...Object.values(counts));
    const top = Object.keys(counts).filter(id => counts[id] === max);

    if (top.length === 1) {
      const out = room.players.find(p => p.id === top[0]);
      if (out) out.alive = false;
    }

    const w = winner(room);
    if (w) {
      room.winner = w;
      room.phase = "finished";
      update(room);
    } else {
      beginNight(room);
    }
  });

  socket.on("disconnect", reason => {
    console.log(`[Socket.IO] disconnected ${socket.id} reason=${reason}`);

    const room = rooms.get(socket.data.room);
    if (!room) return;

    const index = room.players.findIndex(p => p.id === socket.id);
    if (index >= 0) room.players.splice(index, 1);

    if (!room.players.length) {
      rooms.delete(room.code);
      return;
    }

    if (!room.players.some(p => p.host)) {
      room.players[0].host = true;
    }

    update(room);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Werewolf Online listening on 0.0.0.0:${PORT}`);
});
