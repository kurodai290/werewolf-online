const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const crypto=require("crypto");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{transports:["polling","websocket"],cors:{origin:true,methods:["GET","POST"]}});
const PORT=process.env.PORT||3000;
const MAX_PLAYERS=10, MIN_PLAYERS=3;
app.use(express.static("public"));
const rooms=new Map();

const ROLES={
3:["村人","村人","人狼"],
4:["村人","村人","人狼","人狼"],
5:["村人","村人","村人","人狼","人狼"],
6:["村人","村人","村人","人狼","人狼","占い師"],
7:["村人","村人","村人","人狼","人狼","占い師","騎士"],
8:["村人","村人","村人","村人","人狼","人狼","占い師","騎士"],
9:["村人","村人","村人","村人","人狼","人狼","占い師","騎士","霊媒師"],
10:["村人","村人","村人","村人","人狼","人狼","占い師","騎士","霊媒師","狂人"]
}

function shuffle(a){const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]]}return x}
function makeCode(){let c;do{c=crypto.randomBytes(3).toString("hex").toUpperCase()}while(rooms.has(c));return c}
function getRoom(s){return s.data.roomCode?rooms.get(s.data.roomCode):null}
function publicPlayers(r){return r.players.map(p=>({id:p.id,name:p.name,alive:p.alive,host:p.host}))}
function progress(r){
 if(r.phase==="lobby")return{icon:"⏳",title:"待機中",description:`プレイヤー ${r.players.length}/${MAX_PLAYERS}人。${MIN_PLAYERS}人以上で開始できます。`};
 if(r.phase==="night")return{icon:"🌙",title:`${r.day}日目・夜`,description:"役職に応じた夜の行動を行います。"};
 if(r.phase==="day")return{icon:"☀️",title:`${r.day}日目・昼`,description:"生存者で話し合い、人狼だと思う人に投票してください。"};
 return{icon:"🏆",title:"ゲーム終了",description:r.winner?`${r.winner}の勝利です。`:"ゲームが終了しました。"};
}
function update(r){io.to(r.code).emit("room:update",{code:r.code,ownerId:r.ownerId,gmId:r.gmId,phase:r.phase,day:r.day,started:r.started,winner:r.winner,progress:progress(r),players:publicPlayers(r),aliveCount:r.players.filter(p=>p.alive).length,votesCount:Object.keys(r.votes).length})}
function winner(r){const a=r.players.filter(p=>p.alive),w=a.filter(p=>p.role==="人狼").length;const v=a.length-w;if(w===0)return"村人陣営";if(w>=v)return"人狼陣営";return null}
function sendRoles(r){r.players.forEach(p=>p.socket.emit("game:role",{role:p.role,teammates:r.players.filter(q=>q.role==="人狼"&&q.id!==p.id&&q.alive).map(q=>({id:q.id,name:q.name}))}))}
function startNight(r){r.phase="night";r.day++;r.votes={};r.night={wolfTargets:{},seerTargets:{},guardTargets:{}};sendRoles(r);update(r)}
function nightReady(r){const a=r.players.filter(p=>p.alive),w=a.filter(p=>p.role==="人狼"),s=a.filter(p=>p.role==="占い師"),g=a.filter(p=>p.role==="騎士");return(w.length===0||w.every(p=>r.night.wolfTargets[p.id]))&&(s.length===0||s.every(p=>r.night.seerTargets[p.id]))&&(g.length===0||g.every(p=>r.night.guardTargets[p.id]))}
function resolveNight(r){
 const t=Object.values(r.night.wolfTargets)[0]||null,guard=Object.values(r.night.guardTargets)[0]||null;
 if(t&&t!==guard){const p=r.players.find(x=>x.id===t);if(p){p.alive=false;io.to(r.code).emit("game:event",{text:`夜が明けました。${p.name}さんが襲撃されました。`})}}
 else io.to(r.code).emit("game:event",{text:"夜が明けました。昨夜は犠牲者はいませんでした。"});
 const w=winner(r);if(w){r.phase="finished";r.started=false;r.winner=w}else{r.phase="day";r.votes={}}update(r)
}

function chatChannel(r,s,requested){
 const p=r.players.find(x=>x.id===s.id);
 if(r.gmId===s.id)return "all";
 if(!p)return null;
 if(!p.alive)return "dead";
 if(requested==="wolf"&&p.role==="人狼"&&r.phase==="night")return "wolf";
 return "all";
}
function sendChat(r,s,channel,text){
 const p=r.players.find(x=>x.id===s.id);
 const name=r.gmId===s.id?"ゲームマスター":p?.name;
 if(!name)return;
 const m={name,text,channel,senderId:s.id,time:new Date().toISOString()};
 if(channel==="wolf"){r.players.filter(x=>x.alive&&x.role==="人狼").forEach(x=>x.socket.emit("chat:message",m));return;}
 if(channel==="dead"){r.players.filter(x=>!x.alive).forEach(x=>x.socket.emit("chat:message",m));return;}
 io.to(r.code).emit("chat:message",m);
}

io.on("connection",socket=>{
 socket.on("room:create",({name,mode})=>{
  name=String(name||"").trim().slice(0,12);mode=mode==="gm"?"gm":"player";
  if(!name)return socket.emit("error:msg","名前を入力してください。");
  const c=makeCode(),r={code:c,ownerId:socket.id,gmId:mode==="gm"?socket.id:null,players:[],started:false,phase:"lobby",day:0,votes:{},night:{},winner:null};
  if(mode==="player")r.players.push({id:socket.id,socket,name,host:true,alive:true,role:null});
  rooms.set(c,r);socket.join(c);socket.data.roomCode=c;socket.data.isGM=mode==="gm";socket.emit("room:joined",{code:c,mode});update(r)
 });
 socket.on("room:join",({name,code,mode})=>{
  name=String(name||"").trim().slice(0,12);code=String(code||"").trim().toUpperCase();mode=mode==="gm"?"gm":"player";
  const r=rooms.get(code);if(!name)return socket.emit("error:msg","名前を入力してください。");if(!r)return socket.emit("error:msg","そのルームはありません。");if(r.started)return socket.emit("error:msg","ゲーム開始後は参加できません。");
  if(mode==="gm"){if(r.gmId)return socket.emit("error:msg","ゲームマスターはすでに決まっています。");r.gmId=socket.id}
  else{if(r.players.length>=MAX_PLAYERS)return socket.emit("error:msg","プレイヤーが満員です。");r.players.push({id:socket.id,socket,name,host:false,alive:true,role:null})}
  socket.join(code);socket.data.roomCode=code;socket.data.isGM=mode==="gm";socket.emit("room:joined",{code,mode});update(r)
 });
 socket.on("game:start",()=>{
  const r=getRoom(socket);if(!r)return;if(r.ownerId!==socket.id)return socket.emit("error:msg","ルームを作った管理者だけが開始できます。");if(r.players.length<MIN_PLAYERS)return socket.emit("error:msg",`${MIN_PLAYERS}人以上のプレイヤーが必要です。`);
  shuffle(ROLES[r.players.length]).forEach((role,i)=>{r.players[i].role=role;r.players[i].alive=true});r.started=true;r.winner=null;r.day=0;startNight(r)
 });
 socket.on("gm:next",()=>{
  const r=getRoom(socket);if(!r)return;if(r.gmId!==socket.id)return socket.emit("error:msg","ゲームマスターだけが操作できます。");if(!r.started)return socket.emit("error:msg","ゲーム中ではありません。");
  if(r.phase==="night"){resolveNight(r);return}
  if(r.phase==="day"){const w=winner(r);if(w){r.phase="finished";r.started=false;r.winner=w;update(r)}else startNight(r);return}
  socket.emit("error:msg","今は次の日へ進めません。")
 });
 socket.on("chat:send",({channel,text})=>{
  const r=getRoom(socket);
  if(!r)return socket.emit("error:msg","ルームに参加していません。");
  text=String(text||"").trim().slice(0,200);
  if(!text)return;
  const allowed=chatChannel(r,socket,channel);
  if(!allowed)return socket.emit("error:msg","このチャットは使用できません。");
  sendChat(r,socket,allowed,text);
 });
 socket.on("action:night",({action,targetId})=>{
  const r=getRoom(socket);if(!r||r.phase!=="night")return;const me=r.players.find(p=>p.id===socket.id),t=r.players.find(p=>p.id===targetId);if(!me||!me.alive||!t||!t.alive||me.id===t.id)return;
  if(action==="wolf"&&me.role==="人狼")r.night.wolfTargets[me.id]=t.id;
  if(action==="seer"&&me.role==="占い師"){r.night.seerTargets[me.id]=t.id;socket.emit("action:result",{text:`${t.name}さんは${t.role==="人狼"?"人狼です。":"人狼ではありません。"}`})}
  if(action==="guard"&&me.role==="騎士")r.night.guardTargets[me.id]=t.id;
  update(r);if(nightReady(r))resolveNight(r)
 });
 socket.on("action:vote",({targetId})=>{
  const r=getRoom(socket);if(!r||r.phase!=="day")return;const me=r.players.find(p=>p.id===socket.id),t=r.players.find(p=>p.id===targetId);if(!me||!me.alive||!t||!t.alive||me.id===t.id)return;r.votes[me.id]=t.id;update(r);
  const alive=r.players.filter(p=>p.alive);if(Object.keys(r.votes).length<alive.length)return;
  const counts={};Object.values(r.votes).forEach(id=>counts[id]=(counts[id]||0)+1);const max=Math.max(...Object.values(counts)),top=Object.keys(counts).filter(id=>counts[id]===max);
  if(top.length===1){const e=r.players.find(p=>p.id===top[0]);if(e){e.alive=false;io.to(r.code).emit("game:event",{text:`${e.name}さんが投票で脱落しました。`})}}else io.to(r.code).emit("game:event",{text:"投票が同数だったため、今回は処刑されません。"});
  const w=winner(r);if(w){r.phase="finished";r.started=false;r.winner=w;update(r)}else startNight(r)
 });
 socket.on("room:reset",()=>{
  const r=getRoom(socket);if(!r)return;if(r.ownerId!==socket.id)return socket.emit("error:msg","管理者だけがリセットできます。");
  r.started=false;r.phase="lobby";r.day=0;r.votes={};r.night={};r.winner=null;r.players.forEach(p=>{p.role=null;p.alive=true});
  io.to(r.code).emit("room:reset",{message:"🔄 管理者がゲームをリセットしました。"});update(r)
 });
 socket.on("disconnect",()=>{
  const r=getRoom(socket);if(!r)return;if(r.gmId===socket.id)r.gmId=null;
  const i=r.players.findIndex(p=>p.id===socket.id);if(i!==-1)r.players.splice(i,1);
  if(r.players.length===0&&!r.gmId){rooms.delete(r.code);return}update(r)
 })
});

app.get("/health",(req,res)=>res.json({ok:true,service:"werewolf-online",socketio:true,port:PORT,time:new Date().toISOString()}));
server.listen(PORT,"0.0.0.0",()=>console.log(`Werewolf Online running on port ${PORT}`));
