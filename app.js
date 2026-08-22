const socket = io();
const $ = id => document.getElementById(id);

let myId = null;
let myRole = null;
let room = null;
let actionDone = false;

socket.on("connect", () => myId = socket.id);

function msg(t) {
  $("message").textContent = t;
}

$("create").onclick = () => {
  socket.emit("room:create", { name: $("name").value });
};

$("join").onclick = () => {
  socket.emit("room:join", {
    name: $("name").value,
    code: $("code").value
  });
};

$("start").onclick = () => socket.emit("game:start");

socket.on("room:joined", ({ code }) => {
  $("home").classList.add("hidden");
  $("room").classList.remove("hidden");
  $("roomCode").textContent = code;
  msg("ルームに入りました！");
});

socket.on("room:update", data => {
  room = data;
  $("room").classList.remove("hidden");
  $("roomCode").textContent = data.code;
  $("phase").textContent =
    data.phase === "lobby" ? `待機中：${data.players.length}/10人` :
    data.phase === "night" ? `🌙 ${data.day}日目・夜` :
    data.phase === "day" ? `☀️ ${data.day}日目・昼` : "ゲーム終了";

  $("players").innerHTML = data.players.map(p =>
    `<div class="player ${p.alive ? "" : "dead"}">
      <span>${escapeHtml(p.name)}${p.id === myId ? "（自分）" : ""}</span>
      <span>${p.host ? "👑" : ""}${p.alive ? "🟢" : "⚫"}</span>
    </div>`
  ).join("");

  const me = data.players.find(p => p.id === myId);
  $("start").classList.toggle("hidden", !(me && me.host && !data.started));

  if (data.started) $("game").classList.remove("hidden");

  if (data.phase === "finished") {
    $("actionArea").innerHTML = `<div class="winner">🏆 ${data.winner}の勝利！</div>`;
  } else {
    renderAction();
  }
});

socket.on("game:role", data => {
  myRole = data.role;
  actionDone = false;
  $("game").classList.remove("hidden");
  $("roleTitle").textContent = "あなたの役職";
  $("roleText").innerHTML = `<div class="role">${roleEmoji(data.role)} ${data.role}</div>`;
  renderAction();
});

socket.on("action:result", data => {
  msg(data.text);
});

socket.on("error:msg", msg);

function renderAction() {
  if (!room || !myRole || room.phase === "finished") return;
  const me = room.players.find(p => p.id === myId);
  if (!me?.alive) {
    $("actionArea").innerHTML = "<p>あなたは脱落しています。</p>";
    return;
  }

  if (actionDone) {
    $("actionArea").innerHTML = "<p>行動済みです。他のプレイヤーを待っています…</p>";
    return;
  }

  const targets = room.players.filter(p => p.alive && p.id !== myId);
  let html = `<h3>${room.phase === "night" ? "夜の行動" : "投票"}</h3>`;

  if (room.phase === "night") {
    if (!["人狼","占い師","騎士"].includes(myRole)) {
      $("actionArea").innerHTML = "<p>夜は待機してください。</p>";
      return;
    }
    html += targets.map(p =>
      `<button class="target" onclick="night('${p.id}')">${escapeHtml(p.name)}</button>`
    ).join("");
  } else {
    html += targets.map(p =>
      `<button class="target" onclick="vote('${p.id}')">🗳️ ${escapeHtml(p.name)}に投票</button>`
    ).join("");
  }
  $("actionArea").innerHTML = html;
}

window.night = id => {
  if (myRole === "人狼") socket.emit("action:night",{action:"wolf",targetId:id});
  if (myRole === "占い師") socket.emit("action:night",{action:"seer",targetId:id});
  if (myRole === "騎士") socket.emit("action:night",{action:"guard",targetId:id});
  actionDone = true;
  renderAction();
};

window.vote = id => {
  socket.emit("action:vote",{targetId:id});
  actionDone = true;
  renderAction();
};

function roleEmoji(r) {
  return ({人狼:"🐺",占い師:"🔮",騎士:"🛡️",霊媒師:"👻",村人:"👤"})[r] || "❓";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}