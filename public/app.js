let socket;

let myId = null;

let myRole = null;

let room = null;

let actionDone = false;


const $ = id =>
  document.getElementById(id);


const msg = text => {
  $("message").textContent = text;
};


function esc(text) {

  return String(text).replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char])
  );

}


function emoji(role) {

  return ({
    "人狼": "🐺",
    "占い師": "🔮",
    "騎士": "🛡️",
    "霊媒師": "👻",
    "村人": "👤"
  })[role] || "❓";

}


/* ====================================
   ゲーム画面
==================================== */

function render() {

  if (
    !room ||
    !myRole ||
    room.phase === "finished"
  ) {
    return;
  }


  const me =
    room.players.find(
      player => player.id === myId
    );


  if (!me?.alive) {

    $("actionArea").innerHTML =
      "<p>あなたは脱落しています。</p>";

    return;
  }


  if (actionDone) {

    $("actionArea").innerHTML =
      "<p>行動済みです。他のプレイヤーを待っています…</p>";

    return;
  }


  const targets =
    room.players.filter(
      player =>
        player.alive &&
        player.id !== myId
    );


  let html =
    `<h3>${
      room.phase === "night"
        ? "夜の行動"
        : "投票"
    }</h3>`;


  if (room.phase === "night") {

    if (
      ![
        "人狼",
        "占い師",
        "騎士"
      ].includes(myRole)
    ) {

      $("actionArea").innerHTML =
        "<p>夜は待機してください。</p>";

      return;
    }


    html += targets
      .map(
        player =>
          `<button
            class="target"
            onclick="night('${player.id}')"
          >
            ${esc(player.name)}
          </button>`
      )
      .join("");

  } else {

    html += targets
      .map(
        player =>
          `<button
            class="target"
            onclick="vote('${player.id}')"
          >
            🗳️ ${esc(player.name)}に投票
          </button>`
      )
      .join("");

  }


  $("actionArea").innerHTML = html;

}


/* ====================================
   Socket.IO接続
==================================== */

function connect() {

  if (
    typeof io === "undefined"
  ) {

    msg(
      "通信プログラムを読み込めません。ページを再読み込みしてください。"
    );

    return;
  }


  socket = io(
    window.location.origin,
    {
      transports: [
        "polling",
        "websocket"
      ],
      upgrade: true
    }
  );


  socket.on(
    "connect",
    () => {

      myId = socket.id;

      msg(
        "サーバーに接続しました。"
      );

    }
  );


  socket.on(
    "connect_error",
    error => {

      msg(
        "サーバー接続エラー: " +
        error.message
      );

    }
  );


  /* ================================
     ルームに入った
  ================================= */

  socket.on(
    "room:joined",
    ({ code }) => {

      $("home")
        .classList
        .add("hidden");

      $("room")
        .classList
        .remove("hidden");

      $("roomCode")
        .textContent = code;

      msg(
        "ルームに入りました！"
      );

    }
  );


  /* ================================
     ルーム情報更新
  ================================= */

  socket.on(
    "room:update",
    data => {

      room = data;


      $("room")
        .classList
        .remove("hidden");


      $("roomCode")
        .textContent = data.code;


      /* フェーズ表示 */

      if (
        data.phase === "lobby"
      ) {

        $("phase")
          .textContent =
          `待機中：${data.players.length}/10人`;

      } else if (
        data.phase === "night"
      ) {

        $("phase")
          .textContent =
          `🌙 ${data.day}日目・夜`;

      } else if (
        data.phase === "day"
      ) {

        $("phase")
          .textContent =
          `☀️ ${data.day}日目・昼`;

      } else {

        $("phase")
          .textContent =
          "ゲーム終了";

      }


      /* プレイヤー一覧 */

      $("players").innerHTML =
        data.players
          .map(
            player =>
              `<div
                class="player ${
                  player.alive
                    ? ""
                    : "dead"
                }"
              >

                <span>

                  ${esc(player.name)}

                  ${
                    player.id === myId
                      ? "（自分）"
                      : ""
                  }

                </span>

                <span>

                  ${
                    player.host
                      ? "👑"
                      : ""
                  }

                  ${
                    player.alive
                      ? "🟢"
                      : "⚫"
                  }

                </span>

              </div>`
          )
          .join("");


      /* ================================
         ゲーム開始ボタン
      ================================= */

      const me =
        data.players.find(
          player =>
            player.id === myId
        );


      $("start")
        .classList
        .toggle(
          "hidden",
          !(
            me &&
            me.host &&
            !data.started
          )
        );


      /* ================================
         ★管理者リセットボタン
      ================================= */

      $("reset")
        .classList
        .toggle(
          "hidden",
          data.ownerId !== myId
        );


      /* ゲーム画面 */

      if (data.started) {

        $("game")
          .classList
          .remove("hidden");

      }


      /* ゲーム終了 */

      if (
        data.phase === "finished"
      ) {

        $("actionArea")
          .innerHTML =
          `<div class="winner">
            🏆 ${data.winner}の勝利！
          </div>`;

      }


      /* 待機画面 */

      else if (
        data.phase === "lobby"
      ) {

        $("game")
          .classList
          .add("hidden");

        $("actionArea")
          .innerHTML = "";

      }


      /* ゲーム中 */

      else {

        render();

      }

    }
  );


  /* ================================
     役職
  ================================= */

  socket.on(
    "game:role",
    data => {

      myRole = data.role;

      actionDone = false;


      $("game")
        .classList
        .remove("hidden");


      $("roleTitle")
        .textContent =
        "あなたの役職";


      $("roleText")
        .innerHTML =
        `<div class="role">
          ${emoji(data.role)}
          ${data.role}
        </div>`;


      render();

    }
  );


  /* ================================
     占い結果
  ================================= */

  socket.on(
    "action:result",
    data => {

      msg(data.text);

    }
  );


  /* ================================
     エラー
  ================================= */

  socket.on(
    "error:msg",
    text => {

      msg(text);

    }
  );


  /* ================================
     ★リセット通知
  ================================= */

  socket.on(
    "room:reset",
    data => {

      myRole = null;

      actionDone = false;


      $("game")
        .classList
        .add("hidden");


      $("actionArea")
        .innerHTML = "";


      msg(
        data?.message ||
        "管理者がゲームをリセットしました。"
      );

    }
  );

}


/* Socket.IO開始 */

connect();


/* ====================================
   ルーム作成
==================================== */

$("create").onclick = () => {

  if (!socket?.connected) {

    return msg(
      "サーバーに接続中です。少し待ってください。"
    );

  }


  socket.emit(
    "room:create",
    {
      name:
        $("name").value
    }
  );

};


/* ====================================
   ルーム参加
==================================== */

$("join").onclick = () => {

  if (!socket?.connected) {

    return msg(
      "サーバーに接続中です。少し待ってください。"
    );

  }


  socket.emit(
    "room:join",
    {
      name:
        $("name").value,

      code:
        $("code").value
    }
  );

};


/* ====================================
   ゲーム開始
==================================== */

$("start").onclick = () => {

  if (!socket?.connected) {
    return;
  }

  socket.emit(
    "game:start"
  );

};


/* ====================================
   ★管理者リセット
==================================== */

$("reset").onclick = () => {

  if (!socket?.connected) {

    return msg(
      "サーバーに接続中です。"
    );

  }


  if (
    !room ||
    room.ownerId !== myId
  ) {

    return msg(
      "リセットできるのは管理者だけです。"
    );

  }


  const confirmed =
    confirm(
      "ゲームをリセットしますか？\n\n" +
      "全員をこのルームに残したまま、" +
      "ゲームを待機状態に戻します。"
    );


  if (!confirmed) {
    return;
  }


  socket.emit(
    "room:reset"
  );

};


/* ====================================
   夜の行動
==================================== */

window.night = id => {

  if (!socket?.connected) {
    return;
  }


  let action;


  if (
    myRole === "人狼"
  ) {

    action = "wolf";

  } else if (
    myRole === "占い師"
  ) {

    action = "seer";

  } else {

    action = "guard";

  }


  socket.emit(
    "action:night",
    {
      action: action,
      targetId: id
    }
  );


  actionDone = true;

  render();

};


/* ====================================
   投票
==================================== */

window.vote = id => {

  if (!socket?.connected) {
    return;
  }


  socket.emit(
    "action:vote",
    {
      targetId: id
    }
  );


  actionDone = true;

  render();

};
