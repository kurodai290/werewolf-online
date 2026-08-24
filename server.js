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

const MAX_PLAYERS = 10;
const MIN_PLAYERS = 5;

const ROLES = {
  5: [
    "人狼",
    "占い師",
    "騎士",
    "村人",
    "村人"
  ],

  6: [
    "人狼",
    "人狼",
    "占い師",
    "騎士",
    "村人",
    "村人"
  ],

  7: [
    "人狼",
    "人狼",
    "占い師",
    "騎士",
    "霊媒師",
    "村人",
    "村人"
  ],

  8: [
    "人狼",
    "人狼",
    "占い師",
    "騎士",
    "霊媒師",
    "村人",
    "村人",
    "村人"
  ],

  9: [
    "人狼",
    "人狼",
    "人狼",
    "占い師",
    "騎士",
    "霊媒師",
    "村人",
    "村人",
    "村人"
  ],

  10: [
    "人狼",
    "人狼",
    "人狼",
    "占い師",
    "騎士",
    "霊媒師",
    "村人",
    "村人",
    "村人",
    "村人"
  ]
};


/* ========================================
   共通処理
======================================== */

function shuffle(array) {
  return [...array].sort(
    () => Math.random() - 0.5
  );
}


function createRoomCode() {

  let code;

  do {

    code = crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase();

  } while (rooms.has(code));

  return code;
}


function getRoom(socket) {

  if (!socket.data.room) {
    return null;
  }

  return rooms.get(socket.data.room);
}


/* ========================================
   プレイヤー情報
======================================== */

function publicPlayers(room) {

  return room.players.map(player => ({

    id: player.id,

    name: player.name,

    alive: player.alive,

    host: player.host

  }));
}


/* ========================================
   ゲーム進行情報
======================================== */

function getProgress(room) {

  if (room.phase === "lobby") {

    return {
      title: "待機中",
      icon: "⏳",
      description:
        `5〜10人集まるとゲームを開始できます。現在 ${room.players.length}人です。`
    };

  }


  if (room.phase === "night") {

    return {
      title:
        `${room.day}日目・夜`,

      icon: "🌙",

      description:
        "夜の行動を行います。役職に応じた行動を選択してください。"
    };

  }


  if (room.phase === "day") {

    return {
      title:
        `${room.day}日目・昼`,

      icon: "☀️",

      description:
        "昼の時間です。生存者で話し合い、怪しいと思う人に投票してください。"
    };

  }


  return {
    title: "ゲーム終了",
    icon: "🏆",
    description: "ゲームが終了しました。"
  };
}


/* ========================================
   全員へルーム情報を送信
======================================== */

function updateRoom(room) {

  const progress =
    getProgress(room);


  io.to(room.code).emit(
    "room:update",
    {

      code: room.code,

      phase: room.phase,

      day: room.day,

      started: room.started,

      winner: room.winner,

      ownerId: room.ownerId,

      progress: progress,

      players:
        publicPlayers(room),

      votesCount:
        Object.keys(room.votes).length,

      aliveCount:
        room.players.filter(
          player => player.alive
        ).length

    }
  );
}


/* ========================================
   勝敗判定
======================================== */

function checkWinner(room) {

  const alive =
    room.players.filter(
      player => player.alive
    );


  const wolves =
    alive.filter(
      player =>
        player.role === "人狼"
    ).length;


  const villagers =
    alive.length - wolves;


  if (wolves === 0) {

    return "村人陣営";

  }


  if (wolves >= villagers) {

    return "人狼陣営";

  }


  return null;
}


/* ========================================
   夜開始
======================================== */

function startNight(room) {

  room.phase = "night";

  room.day++;

  room.votes = {};

  room.night = {

    wolfTargets: {},

    seerTargets: {},

    guardTargets: {}

  };


  room.players.forEach(player => {

    if (!player.alive) {
      return;
    }


    player.socket.emit(
      "game:role",
      {

        role: player.role,

        teammateIds:
          room.players
            .filter(
              other =>
                other.role === "人狼" &&
                other.id !== player.id &&
                other.alive
            )
            .map(
              other => other.id
            )

      }
    );

  });


  updateRoom(room);
}


/* ========================================
   夜終了判定
======================================== */

function nightReady(room) {

  const alive =
    room.players.filter(
      player => player.alive
    );


  const wolves =
    alive.filter(
      player =>
        player.role === "人狼"
    );


  const seers =
    alive.filter(
      player =>
        player.role === "占い師"
    );


  const guards =
    alive.filter(
      player =>
        player.role === "騎士"
    );


  const wolvesReady =
    wolves.length === 0 ||
    wolves.every(
      wolf =>
        room.night.wolfTargets[
          wolf.id
        ]
    );


  const seerReady =
    seers.length === 0 ||
    seers.every(
      seer =>
        room.night.seerTargets[
          seer.id
        ]
    );


  const guardReady =
    guards.length === 0 ||
    guards.every(
      guard =>
        room.night.guardTargets[
          guard.id
        ]
    );


  return (
    wolvesReady &&
    seerReady &&
    guardReady
  );
}


/* ========================================
   夜を解決
======================================== */

function resolveNight(room) {

  const wolfTargets =
    Object.values(
      room.night.wolfTargets
    );


  const targetId =
    wolfTargets.length > 0
      ? wolfTargets[0]
      : null;


  const guardTargets =
    Object.values(
      room.night.guardTargets
    );


  const protectedId =
    guardTargets.length > 0
      ? guardTargets[0]
      : null;


  if (
    targetId &&
    targetId !== protectedId
  ) {

    const target =
      room.players.find(
        player =>
          player.id === targetId
      );


    if (target) {

      target.alive = false;

    }

  }


  const winner =
    checkWinner(room);


  if (winner) {

    room.phase = "finished";

    room.started = false;

    room.winner = winner;

    updateRoom(room);

    return;
  }


  room.phase = "day";

  room.votes = {};

  updateRoom(room);
}


/* ========================================
   接続
======================================== */

io.on("connection", socket => {

  console.log(
    "Connected:",
    socket.id
  );


  /* ======================================
     ルーム作成
  ====================================== */

  socket.on(
    "room:create",
    ({ name }) => {

      name =
        String(name || "")
          .trim()
          .slice(0, 12);


      if (!name) {

        return socket.emit(
          "error:msg",
          "名前を入力してください。"
        );

      }


      const code =
        createRoomCode();


      const room = {

        code: code,

        /* ★最初に作った人 */
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

        host: true,

        alive: true,

        role: null

      });


      rooms.set(
        code,
        room
      );


      socket.join(code);

      socket.data.room = code;


      socket.emit(
        "room:joined",
        {
          code: code
        }
      );


      updateRoom(room);

    }
  );


  /* ======================================
     ルーム参加
  ====================================== */

  socket.on(
    "room:join",
    ({ code, name }) => {

      code =
        String(code || "")
          .trim()
          .toUpperCase();


      name =
        String(name || "")
          .trim()
          .slice(0, 12);


      const room =
        rooms.get(code);


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
          "ゲームはすでに開始されています。"
        );

      }


      if (
        room.players.length >=
        MAX_PLAYERS
      ) {

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


      socket.emit(
        "room:joined",
        {
          code: code
        }
      );


      updateRoom(room);

    }
  );


  /* ======================================
     ゲーム開始
  ====================================== */

  socket.on(
    "game:start",
    () => {

      const room =
        getRoom(socket);


      if (!room) {
        return;
      }


      const me =
        room.players.find(
          player =>
            player.id === socket.id
        );


      if (
        !me ||
        !me.host
      ) {

        return socket.emit(
          "error:msg",
          "ホストだけがゲームを開始できます。"
        );

      }


      if (
        room.players.length <
        MIN_PLAYERS
      ) {

        return socket.emit(
          "error:msg",
          "5人以上集めてください。"
        );

      }


      const roles =
        ROLES[
          room.players.length
        ];


      const shuffledPlayers =
        shuffle(room.players);


      shuffledPlayers.forEach(
        (player, index) => {

          player.role =
            roles[index];

          player.alive = true;

        }
      );


      room.started = true;

      room.winner = null;

      room.day = 0;


      startNight(room);

    }
  );


  /* ======================================
     夜の行動
  ====================================== */

  socket.on(
    "action:night",
    ({
      action,
      targetId
    }) => {

      const room =
        getRoom(socket);


      if (
        !room ||
        room.phase !== "night"
      ) {
        return;
      }


      const me =
        room.players.find(
          player =>
            player.id === socket.id
        );


      const target =
        room.players.find(
          player =>
            player.id === targetId
        );


      if (
        !me ||
        !me.alive ||
        !target ||
        !target.alive ||
        target.id === me.id
      ) {

        return;
      }


      /* 人狼 */

      if (
        action === "wolf" &&
        me.role === "人狼"
      ) {

        room.night.wolfTargets[
          me.id
        ] = target.id;

      }


      /* 占い師 */

      if (
        action === "seer" &&
        me.role === "占い師"
      ) {

        room.night.seerTargets[
          me.id
        ] = target.id;


        socket.emit(
          "action:result",
          {

            text:
              `${target.name}さんは` +
              `${
                target.role === "人狼"
                  ? "人狼です。"
                  : "人狼ではありません。"
              }`

          }
        );

      }


      /* 騎士 */

      if (
        action === "guard" &&
        me.role === "騎士"
      ) {

        room.night.guardTargets[
          me.id
        ] = target.id;

      }


      updateRoom(room);


      if (
        nightReady(room)
      ) {

        resolveNight(room);

      }

    }
  );


  /* ======================================
     昼の投票
  ====================================== */

  socket.on(
    "action:vote",
    ({ targetId }) => {

      const room =
        getRoom(socket);


      if (
        !room ||
        room.phase !== "day"
      ) {
        return;
      }


      const me =
        room.players.find(
          player =>
            player.id === socket.id
        );


      const target =
        room.players.find(
          player =>
            player.id === targetId
        );


      if (
        !me ||
        !me.alive ||
        !target ||
        !target.alive ||
        target.id === me.id
      ) {

        return;
      }


      room.votes[
        me.id
      ] = target.id;


      updateRoom(room);


      const alive =
        room.players.filter(
          player =>
            player.alive
        );


      if (
        Object.keys(room.votes).length <
        alive.length
      ) {

        return;
      }


      const counts = {};


      Object.values(
        room.votes
      ).forEach(id => {

        counts[id] =
          (counts[id] || 0) + 1;

      });


      const max =
        Math.max(
          ...Object.values(counts)
        );


      const top =
        Object.keys(counts)
          .filter(
            id =>
              counts[id] === max
          );


      /* 同数なら今回は処刑なし */

      if (top.length === 1) {

        const eliminated =
          room.players.find(
            player =>
              player.id === top[0]
          );


        if (eliminated) {

          eliminated.alive = false;

        }

      }


      const winner =
        checkWinner(room);


      if (winner) {

        room.started = false;

        room.phase = "finished";

        room.winner = winner;

        updateRoom(room);

        return;

      }


      startNight(room);

    }
  );


  /* ======================================
     ★ 管理者リセット
  ====================================== */

  socket.on(
    "room:reset",
    () => {

      const room =
        getRoom(socket);


      if (!room) {

        return socket.emit(
          "error:msg",
          "ルームに参加していません。"
        );

      }


      /* ★最初に作った人だけ */

      if (
        room.ownerId !==
        socket.id
      ) {

        return socket.emit(
          "error:msg",
          "管理者だけがリセットできます。"
        );

      }


      /* ゲーム状態を完全リセット */

      room.started = false;

      room.phase = "lobby";

      room.day = 0;

      room.votes = {};

      room.night = {};

      room.winner = null;


      room.players.forEach(
        player => {

          player.role = null;

          player.alive = true;

        }
      );


      /*
       * ★まず全員へリセット通知
       */

      io.to(room.code).emit(
        "room:reset",
        {
          message:
            "管理者がゲームをリセットしました。"
        }
      );


      /*
       * ★その直後に全員へ
       *   最新ルーム状態を送る
       */

      updateRoom(room);

    }
  );


  /* ======================================
     切断
  ====================================== */

  socket.on(
    "disconnect",
    () => {

      const room =
        getRoom(socket);


      if (!room) {
        return;
      }


      const index =
        room.players.findIndex(
          player =>
            player.id === socket.id
        );


      if (index !== -1) {

        room.players.splice(
          index,
          1
        );

      }


      if (
        room.players.length === 0
      ) {

        rooms.delete(
          room.code
        );

        return;
      }


      /*
       * 管理者が切断しても
       * ownerIdは変更しない
       *
       * これによって
       * 「最初に作った人」
       * という条件を維持する
       */


      if (
        !room.players.some(
          player =>
            player.host
        )
      ) {

        room.players[0].host =
          true;

      }


      updateRoom(room);

    }
  );

});


/* ========================================
   サーバー起動
======================================== */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Werewolf Online running on port ${PORT}`
    );

  }
);
