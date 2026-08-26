let socket = null;

let myId = null;
let myRole = null;
let room = null;
let actionDone = false;


/* ====================================
   DOM helper
==================================== */

const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setHTML(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function addClass(id, className) {
  const el = $(id);
  if (el) el.classList.add(className);
}

function removeClass(id, className) {
  const el = $(id);
  if (el) el.classList.remove(className);
}

function toggleClass(id, className, hidden) {
  const el = $(id);
  if (el) el.classList.toggle(className, hidden);
}

const msg = (text) => {
  setText("message", text);
};


/* ====================================
   HTMLエスケープ
==================================== */

function esc(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char])
  );
}


/* ====================================
   役職アイコン
==================================== */

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

  if (!room) return;

  const actionArea = $("actionArea");

  if (!actionArea) return;


  /* ゲーム終了 */

  if (room.phase === "finished") {

    setHTML(
      "actionArea",
      `<div class="winner">
        🏆 ${esc(room.winner || "ゲーム終了")}の勝利！
      </div>`
    );

    return;
  }


  /* ロビー */

  if (
    !room.started ||
    room.phase === "lobby"
  ) {

    actionArea.innerHTML = "";

    return;
  }


  /* 自分を探す */

  const me =
    Array.isArray(room.players)
      ? room.players.find(
          player => player.id === myId
        )
      : null;


  /* ====================================
     GM判定
  ==================================== */

  const isGM =
    room.gameMasterId === myId ||
    room.gmId === myId ||
    room.isGM === true ||
    me?.gm === true ||
    me?.gameMaster === true;


  /* ====================================
     GM画面
  ==================================== */

  if (isGM) {

    actionArea.innerHTML = `
      <div class="gm-panel">

        <h3>👑 ゲームマスター</h3>

        <p>
          ゲームの進行を担当しています。
        </p>

        <button
          id="gmNextDay"
          type="button"
        >
          ⏭️ 次の日へ進める
        </button>

      </div>
    `;


    const gmButton =
      $("gmNextDay");


    if (gmButton) {

      gmButton.onclick = () => {

        if (!socket?.connected) {

          return msg(
            "サーバーに接続されていません。"
          );

        }


        socket.emit(
          "gm:next-day"
        );


        msg(
          "次の日へ進めています…"
        );

      };

    }


    return;
  }


  /* ====================================
     役職がまだ届いていない
  ==================================== */

  if (!myRole) {

    actionArea.innerHTML =
      "<p>役職情報を待っています…</p>";

    return;
  }


  /* ====================================
     脱落
  ==================================== */

  if (
    me &&
    !me.alive
  ) {

    actionArea.innerHTML =
      "<p>あなたは脱落しています。</p>";

    return;
  }


  /* ====================================
     行動済み
  ==================================== */

  if (actionDone) {

    actionArea.innerHTML =
      "<p>行動済みです。他のプレイヤーを待っています…</p>";

    return;
  }


  /* ====================================
     生存プレイヤー
  ==================================== */

  const players =
    Array.isArray(room.players)
      ? room.players
      : [];


  const targets =
    players.filter(
      player =>
        player.alive &&
        player.id !== myId
    );


  let html =
    `<h3>
      ${
        room.phase === "night"
          ? "🌙 夜の行動"
          : "☀️ 投票"
      }
    </h3>`;


  /* ====================================
     夜
  ==================================== */

  if (
    room.phase === "night"
  ) {

    if (
      ![
        "人狼",
        "占い師",
        "騎士"
      ].includes(myRole)
    ) {

      actionArea.innerHTML =
        "<p>夜は待機してください。</p>";

      return;
    }


    if (targets.length) {

      html +=
        targets
          .map(
            player =>
              `<button
                class="target"
                data-action="night"
                data-id="${esc(player.id)}"
              >
                ${esc(player.name)}
              </button>`
          )
          .join("");

    } else {

      html +=
        "<p>行動できる相手がいません。</p>";

    }

  }


  /* ====================================
     昼
  ==================================== */

  else if (
    room.phase === "day"
  ) {

    if (targets.length) {

      html +=
        targets
          .map(
            player =>
              `<button
                class="target"
                data-action="vote"
                data-id="${esc(player.id)}"
              >
                🗳️ ${esc(player.name)}に投票
              </button>`
          )
          .join("");

    } else {

      html +=
        "<p>投票できる相手がいません。</p>";

    }

  }


  /* その他 */

  else {

    html +=
      "<p>現在は待機中です。</p>";

  }


  actionArea.innerHTML =
    html;


  /* ====================================
     夜ボタン
  ==================================== */

  actionArea
    .querySelectorAll(
      "[data-action='night']"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            night(
              button.dataset.id
            );

          }
        );

      }
    );


  /* ====================================
     投票ボタン
  ==================================== */

  actionArea
    .querySelectorAll(
      "[data-action='vote']"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            vote(
              button.dataset.id
            );

          }
        );

      }
    );

}


/* ====================================
   プレイヤー一覧
==================================== */

function renderPlayers(players) {

  const playersElement =
    $("players");


  if (!playersElement) {

    console.error(
      'HTMLに id="players" がありません。'
    );

    return;
  }


  if (!Array.isArray(players)) {

    playersElement.innerHTML =
      "<p>参加者情報を取得できませんでした。</p>";

    return;
  }


  if (players.length === 0) {

    playersElement.innerHTML =
      "<p>まだプレイヤーがいません。</p>";

    return;
  }


  /*
   * ★ここで全員を表示
   */

  playersElement.innerHTML =
    players
      .map(
        player => `

          <div
            class="player ${
              player.alive === false
                ? "dead"
                : ""
            }"
          >

            <span>

              ${esc(
                player.name ||
                "名前なし"
              )}

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
                player.gm ||
                player.gameMaster
                  ? "🎮"
                  : ""
              }

              ${
                player.alive === false
                  ? "⚫"
                  : "🟢"
              }

            </span>

          </div>

        `
      )
      .join("");

}


/* ====================================
   ルーム画面更新
==================================== */

function updateRoomScreen(data) {

  if (!data) return;


  room = data;


  const players =
    Array.isArray(data.players)
      ? data.players
      : [];


  removeClass(
    "room",
    "hidden"
  );


  setText(
    "roomCode",
    data.code || ""
  );


  /* ====================================
     フェーズ
  ==================================== */

  if (
    data.phase === "lobby"
  ) {

    setText(
      "phase",
      `待機中：${players.length}/10人`
    );

  }

  else if (
    data.phase === "night"
  ) {

    setText(
      "phase",
      `🌙 ${data.day || 1}日目・夜`
    );

  }

  else if (
    data.phase === "day"
  ) {

    setText(
      "phase",
      `☀️ ${data.day || 1}日目・昼`
    );

  }

  else if (
    data.phase === "finished"
  ) {

    setText(
      "phase",
      "ゲーム終了"
    );

  }

  else {

    setText(
      "phase",
      "ゲーム進行中"
    );

  }


  /* ====================================
     ★人数表示
  ==================================== */

  setText(
    "playerCount",
    `${players.length} / 10人`
  );


  /* ====================================
     ★プレイヤー一覧
  ==================================== */

  renderPlayers(
    players
  );


  /* ====================================
     自分
  ==================================== */

  const me =
    players.find(
      player =>
        player.id === myId
    );


  /* ====================================
     ゲーム開始ボタン
  ==================================== */

  toggleClass(
    "start",
    "hidden",
    !(
      me &&
      me.host &&
      !data.started
    )
  );


  /* ====================================
     管理者リセット
  ==================================== */

  toggleClass(
    "reset",
    "hidden",
    data.ownerId !== myId
  );


  /* ====================================
     GM判定
  ==================================== */

  const isGM =
    data.gameMasterId === myId ||
    data.gmId === myId ||
    data.isGM === true ||
    me?.gm === true ||
    me?.gameMaster === true;


  const gmLabel =
    $("gmLabel");


  if (gmLabel) {

    gmLabel.textContent =
      isGM
        ? "👑 ゲームマスター"
        : "";

  }


  /* ====================================
     ゲーム画面
  ==================================== */

  if (
    data.started
  ) {

    removeClass(
      "game",
      "hidden"
    );

  }

  else {

    addClass(
      "game",
      "hidden"
    );

  }


  /* ====================================
     ゲーム終了
  ==================================== */

  if (
    data.phase === "finished"
  ) {

    setHTML(
      "actionArea",
      `
      <div class="winner">

        🏆 ${
          esc(
            data.winner ||
            "ゲーム終了"
          )
        }の勝利！

      </div>
      `
    );

    return;
  }


  /* ====================================
     ロビー
  ==================================== */

  if (
    !data.started ||
    data.phase === "lobby"
  ) {

    addClass(
      "game",
      "hidden"
    );


    setHTML(
      "actionArea",
      ""
    );


    return;
  }


  /* ====================================
     ゲーム中
  ==================================== */

  render();

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


  socket =
    io(
      window.location.origin,
      {
        transports: [
          "polling",
          "websocket"
        ],

        upgrade: true,

        reconnection: true,

        reconnectionAttempts:
          Infinity,

        reconnectionDelay:
          1000
      }
    );


  /* ====================================
     接続成功
  ==================================== */

  socket.on(
    "connect",
    () => {

      myId =
        socket.id;


      msg(
        "サーバーに接続しました。"
      );


      console.log(
        "Socket connected:",
        myId
      );

    }
  );


  /* ====================================
     切断
  ==================================== */

  socket.on(
    "disconnect",
    reason => {

      msg(
        "サーバーとの接続が切れました。再接続しています…"
      );


      console.warn(
        "Socket disconnected:",
        reason
      );

    }
  );


  /* ====================================
     接続エラー
  ==================================== */

  socket.on(
    "connect_error",
    error => {

      msg(
        "サーバー接続エラー: " +
        (
          error?.message ||
          "不明なエラー"
        )
      );


      console.error(
        "Socket connection error:",
        error
      );

    }
  );


  /* ====================================
     ルームに入った
  ==================================== */

  socket.on(
    "room:joined",
    ({ code }) => {

      addClass(
        "home",
        "hidden"
      );


      removeClass(
        "room",
        "hidden"
      );


      setText(
        "roomCode",
        code || ""
      );


      msg(
        "ルームに入りました！"
      );

    }
  );


  /* ====================================
     ★ルーム情報更新
  ==================================== */

  socket.on(
    "room:update",
    data => {

      console.log(
        "room:update:",
        data
      );


      if (!data) {

        console.error(
          "room:update にデータがありません。"
        );

        return;
      }


      try {

        updateRoomScreen(
          data
        );

      }

      catch (error) {

        console.error(
          "room:update の画面更新中にエラー:",
          error
        );


        msg(
          "画面更新中にエラーが発生しました。"
        );

      }

    }
  );


  /* ====================================
     役職
  ==================================== */

  socket.on(
    "game:role",
    data => {

      myRole =
        data?.role ||
        null;


      actionDone =
        false;


      removeClass(
        "game",
        "hidden"
      );


      setText(
        "roleTitle",
        "あなたの役職"
      );


      if (
        data?.role
      ) {

        setHTML(
          "roleText",
          `
          <div class="role">

            ${emoji(
              data.role
            )}

            ${esc(
              data.role
            )}

          </div>
          `
        );

      }


      render();

    }
  );


  /* ====================================
     行動結果
  ==================================== */

  socket.on(
    "action:result",
    data => {

      msg(
        data?.text ||
        ""
      );

    }
  );


  /* ====================================
     エラー
  ==================================== */

  socket.on(
    "error:msg",
    text => {

      msg(
        text ||
        "エラーが発生しました。"
      );

    }
  );


  /* ====================================
     ★リセット通知
  ==================================== */

  socket.on(
    "room:reset",
    data => {

      myRole =
        null;


      actionDone =
        false;


      addClass(
        "game",
        "hidden"
      );


      setHTML(
        "actionArea",
        ""
      );


      msg(
        data?.message ||
        "管理者がゲームをリセットしました。"
      );

    }
  );


  /* ====================================
     ★GM進行通知
  ==================================== */

  socket.on(
    "gm:updated",
    data => {

      actionDone =
        false;


      if (
        data?.room
      ) {

        updateRoomScreen(
          data.room
        );

      }


      msg(
        data?.message ||
        "ゲームマスターがゲームを進行しました。"
      );

    }
  );

}


/* ====================================
   Socket.IO開始
==================================== */

connect();


/* ====================================
   ボタン設定
==================================== */

function setupButtons() {

  /* ====================================
     ルーム作成
  ==================================== */

  const createButton =
    $("create");


  if (
    createButton
  ) {

    createButton.onclick =
      () => {

        if (
          !socket?.connected
        ) {

          return msg(
            "サーバーに接続中です。少し待ってください。"
          );

        }


        socket.emit(
          "room:create",
          {
            name:
              $("name")?.value ||
              ""
          }
        );

      };

  }


  /* ====================================
     ルーム参加
  ==================================== */

  const joinButton =
    $("join");


  if (
    joinButton
  ) {

    joinButton.onclick =
      () => {

        if (
          !socket?.connected
        ) {

          return msg(
            "サーバーに接続中です。少し待ってください。"
          );

        }


        socket.emit(
          "room:join",
          {
            name:
              $("name")?.value ||
              "",

            code:
              $("code")?.value ||
              ""
          }
        );

      };

  }


  /* ====================================
     ゲーム開始
  ==================================== */

  const startButton =
    $("start");


  if (
    startButton
  ) {

    startButton.onclick =
      () => {

        if (
          !socket?.connected
        ) {

          return;
        }


        socket.emit(
          "game:start"
        );

      };

  }


  /* ====================================
     管理者リセット
  ==================================== */

  const resetButton =
    $("reset");


  if (
    resetButton
  ) {

    resetButton.onclick =
      () => {

        if (
          !socket?.connected
        ) {

          return msg(
            "サーバーに接続されていません。"
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


        if (
          !confirmed
        ) {

          return;
        }


        socket.emit(
          "room:reset"
        );

      };

  }

}


/* ====================================
   DOM読み込み後にボタン設定
==================================== */

if (
  document.readyState === "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    setupButtons
  );

}

else {

  setupButtons();

}


/* ====================================
   夜の行動
==================================== */

window.night =
  (id) => {

    if (
      !socket?.connected
    ) {

      return;
    }


    let action;


    if (
      myRole === "人狼"
    ) {

      action =
        "wolf";

    }

    else if (
      myRole === "占い師"
    ) {

      action =
        "seer";

    }

    else if (
      myRole === "騎士"
    ) {

      action =
        "guard";

    }

    else {

      return;
    }


    socket.emit(
      "action:night",
      {
        action,
        targetId: id
      }
    );


    actionDone =
      true;


    render();

  };


/* ====================================
   投票
==================================== */

window.vote =
  (id) => {

    if (
      !socket?.connected
    ) {

      return;
    }


    socket.emit(
      "action:vote",
      {
        targetId: id
      }
    );


    actionDone =
      true;


    render();

  };
