const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ["polling", "websocket"],
  cors: {
    origin: true,
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const rooms = new Map();
const MAX = 10;

const ROLES = {
  5: ["人狼", "占い師", "騎士", "村人", "村人"],
  6: ["人狼", "人狼", "占い師", "騎士", "村人", "村人"],
  7: ["人狼", "人狼", "占い師", "騎士", "霊媒師", "村人", "村人"],
  8: ["人狼", "人狼", "占い師", "騎士", "霊媒師", "村人", "村人", "村人"],
  9: ["人狼", "人狼", "人狼", "占い師", "騎士", "霊媒師", "村人", "村人", "村人"],
  10: ["人狼", "人狼", "人狼", "占い師", "騎士", "霊媒師", "村人", "村人", "村人", "村人"]
};

const shuffle = array => {
  return [...array].sort(() => Math.random() - 0.5);
};

function createRoomCode() {
  let code;

  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));

  return code;
}

function publicPlayers(room) {
  return room.players.map(player => ({
    id: player.id,
    name: player.name,
    alive: player.alive,
    host: player.host
  }));
}

function updateRoom(room) {
  io.to(room.code).emit("room:update", {
    code: room.code,
    phase: room.phase,
    day: room.day,
    players: publicPlayers(room),
    started: room.started,
    winner: room.winner,

    // 最初に部屋を作った人
    ownerId: room.ownerId
  });
}

function checkWinner(room) {
  const alivePlayers = room.players.filter(player => player.alive);

  const wolves = alivePlayers.filter(
    player => player.role === "人狼"
  ).length;

  if (wolves === 0) {
    return "村人陣営";
  }

  if (wolves >= alivePlayers.length - wolves) {
    return "人狼陣営";
  }

  return null;
}

function startNight(room) {
  room.phase = "night";
  room.day++;

  room.votes = {};

  room.night = {
    wolf: null,
    seer: null,
    guard: null
  };

  room.players.forEach(player => {
    if (!player.alive) return;

    player.socket.emit("game:role", {
      role: player.role,

      teammateIds: room.players
        .filter(
          other =>
            other.role === "人狼" &&
            other.id !== player.id
        )
        .map(other => other.id)
    });
  });

  updateRoom(room);
}

function resolveNight(room) {
  if (
    room.night.wolf &&
    room.night.guard !== room.night.wolf
  ) {
    const target = room.players.find(
      player => player.id === room.night.wolf
    );

    if (target) {
      target.alive = false;
    }
  }

  const winner = checkWinner(room);

  if (winner) {
    room.winner = winner;
    room.phase = "finished";
  } else {
    room.phase = "day";
    room.votes = {};
  }

  updateRoom(room);
}

io.on("connection", socket => {

  console.log("Connected:", socket.id);

  // ========================================
  // ルーム作成
  // ========================================

  socket.on("room:create", ({ name }) => {

    name = String(name || "")
      .trim()
      .slice(0, 12);

    if (!name) {
      return socket.emit(
        "error:msg",
        "名前を入力してください。"
      );
    }

    const code = createRoomCode();

    const room = {
      code,

      // ★最初に部屋を作った人
      ownerId: socket.id,

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
      socket: socket,

      name: name,

      // 最初の人なのでホスト
      host: true,

      alive: true,

      role: null
    });

    rooms.set(code, room);

    socket.join(code);

    socket.data.room = code;

    socket.emit("room:joined", {
      code: code
    });

    updateRoom(room);
  });


  // ========================================
  // ルーム参加
  // ========================================

  socket.on("room:join", ({ code, name }) => {

    code = String(code || "")
      .trim()
      .toUpperCase();

    name = String(name || "")
      .trim()
      .slice(0, 12);

    const room = rooms.get(code);

    if (!name) {
      return socket.emit(
        "error:msg",
        "名前を入力してください。"
      );
    }

    if (!room) {
      return socket.emit(
        "error:msg",
        "そのルームはありません。"
      );
    }

    if (room.started) {
      return socket.emit(
        "error:msg",
        "ゲームはすでに始まっています。"
      );
    }

    if (room.players.length >= MAX) {
      return socket.emit(
        "error:msg",
        "満員です。"
      );
    }

    room.players.push({
      id: socket.id,
      socket: socket,

      name: name,

      host: false,

      alive: true,

      role: null
    });

    socket.join(code);

    socket.data.room = code;

    socket.emit("room:joined", {
      code: code
    });

    updateRoom(room);
  });


  // ========================================
  // ゲーム開始
  // ========================================

  socket.on("game:start", () => {

    const room = rooms.get(socket.data.room);

    if (!room) return;

    const me = room.players.find(
      player => player.id === socket.id
    );

    if (!me?.host) {
      return socket.emit(
        "error:msg",
        "ホストだけが開始できます。"
      );
    }

    if (room.players.length < 5) {
      return socket.emit(
        "error:msg",
        "5人以上で開始してください。"
      );
    }

    const roles = ROLES[room.players.length];

    shuffle(room.players).forEach((player, index) => {

      player.role = roles[index];

      player.alive = true;

    });

    room.started = true;

    room.winner = null;

    room.day = 0;

    startNight(room);
  });


  // ========================================
  // 夜の行動
  // ========================================

  socket.on(
    "action:night",
    ({ action, targetId }) => {

      const room = rooms.get(socket.data.room);

      if (!room || room.phase !== "night") {
        return;
      }

      const me = room.players.find(
        player => player.id === socket.id
      );

      const target = room.players.find(
        player => player.id === targetId
      );

      if (
        !me?.alive ||
        !target?.alive ||
        target.id === me.id
      ) {
        return;
      }

      if (
        action === "wolf" &&
        me.role === "人狼"
      ) {
        room.night.wolf = target.id;
      }

      if (
        action === "seer" &&
        me.role === "占い師"
      ) {

        socket.emit(
          "action:result",
          {
            text:
              `${target.name}さんは` +
              `${target.role === "人狼"
                ? "人狼"
                : "人狼ではありません"}。`
          }
        );

        room.night.seer = target.id;
      }

      if (
        action === "guard" &&
        me.role === "騎士"
      ) {
        room.night.guard = target.id;
      }

      const alivePlayers =
        room.players.filter(
          player => player.alive
        );

      const wolvesDone =
        alivePlayers
          .filter(player => player.role === "人狼")
          .every(() => room.night.wolf);

      const seerDone =
        alivePlayers
          .filter(player => player.role === "占い師")
          .every(() => room.night.seer);

      const guardDone =
        alivePlayers
          .filter(player => player.role === "騎士")
          .every(() => room.night.guard);

      if (
        wolvesDone &&
        seerDone &&
        guardDone
      ) {
        resolveNight(room);
      }
    }
  );


  // ========================================
  // 投票
  // ========================================

  socket.on(
    "action:vote",
    ({ targetId }) => {

      const room = rooms.get(socket.data.room);

      if (!room || room.phase !== "day") {
        return;
      }

      const me = room.players.find(
        player => player.id === socket.id
      );

      const target = room.players.find(
        player => player.id === targetId
      );

      if (
        !me?.alive ||
        !target?.alive ||
        target.id === me.id
      ) {
        return;
      }

      room.votes[me.id] = target.id;

      const alivePlayers =
        room.players.filter(
          player => player.alive
        );

      if (
        Object.keys(room.votes).length <
        alivePlayers.length
      ) {
        return;
      }

      const counts = {};

      Object.values(room.votes).forEach(id => {
        counts[id] =
          (counts[id] || 0) + 1;
      });

      const maxVotes =
        Math.max(...Object.values(counts));

      const topPlayers =
        Object.keys(counts).filter(
          id => counts[id] === maxVotes
        );

      if (topPlayers.length === 1) {

        const eliminated =
          room.players.find(
            player => player.id === topPlayers[0]
          );

        if (eliminated) {
          eliminated.alive = false;
        }
      }

      const winner = checkWinner(room);

      if (winner) {

        room.winner = winner;

        room.phase = "finished";

        updateRoom(room);

      } else {

        startNight(room);

      }
    }
  );


  // ========================================
  // ★ 管理者によるリセット
  // ========================================

  socket.on("room:reset", () => {

    const room = rooms.get(socket.data.room);

    if (!room) {
      return socket.emit(
        "error:msg",
        "ルームに参加していません。"
      );
    }

    // ★最初に部屋を作った人だけ
    if (room.ownerId !== socket.id) {

      return socket.emit(
        "error:msg",
        "リセットできるのは、最初に部屋を作った管理者だけです。"
      );
    }

    // ゲーム状態を初期化

    room.started = false;

    room.phase = "lobby";

    room.day = 0;

    room.votes = {};

    room.night = {};

    room.winner = null;


    // 全員を生存状態に戻す

    room.players.forEach(player => {

      player.role = null;

      player.alive = true;

    });


    // 全員にリセット通知

    io.to(room.code).emit(
      "room:reset",
      {
        message:
          "管理者がゲームをリセットしました。"
      }
    );


    // 全員の画面を更新

    updateRoom(room);

  });


  // ========================================
  // 切断
  // ========================================

  socket.on("disconnect", () => {

    const room =
      rooms.get(socket.data.room);

    if (!room) return;

    const index =
      room.players.findIndex(
        player => player.id === socket.id
      );

    if (index >= 0) {
      room.players.splice(index, 1);
    }

    if (!room.players.length) {

      rooms.delete(room.code);

      return;
    }


    // 現在のホストがいなくなった場合
    // 次の人をホストにする

    if (
      !room.players.some(
        player => player.host
      )
    ) {

      room.players[0].host = true;
    }


    updateRoom(room);
  });

});


server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "Werewolf Online on " + PORT
    );
  }
);
