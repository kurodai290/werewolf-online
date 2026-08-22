const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const crypto=require("crypto");
const app=express(),server=http.createServer(app),io=new Server(server);
const PORT=process.env.PORT||3000; app.use(express.static("public"));
const rooms=new Map(),MAX=10;
const ROLES={5:["人狼","占い師","騎士","村人","村人"],6:["人狼","人狼","占い師","騎士","村人","村人"],7:["人狼","人狼","占い師","騎士","霊媒師","村人","村人"],8:["人狼","人狼","占い師","騎士","霊媒師","村人","村人","村人"],9:["人狼","人狼","人狼","占い師","騎士","霊媒師","村人","村人","村人"],10:["人狼","人狼","人狼","占い師","騎士","霊媒師","村人","村人","村人","村人"]};
const shuffle=a=>[...a].sort(()=>Math.random()-.5);
function code(){let c;do c=crypto.randomBytes(3).toString("hex").toUpperCase();while(rooms.has(c));return c}
function pub(r){return r.players.map(p=>({id:p.id,name:p.name,alive:p.alive,host:p.host}))}
function update(r){io.to(r.code).emit("room:update",{code:r.code,phase:r.phase,day:r.day,players:pub(r),started:r.started,winner:r.winner})}
function win(r){let a=r.players.filter(p=>p.alive),w=a.filter(p=>p.role==="人狼").length;if(!w)return"村人陣営";if(w>=a.length-w)return"人狼陣営";return null}
function night(r){r.phase="night";r.day++;r.votes={};r.night={wolf:null,seer:null,guard:null};r.players.forEach(p=>{if(p.alive)p.socket.emit("game:role",{role:p.role,teammateIds:r.players.filter(x=>x.role==="人狼"&&x.id!==p.id).map(x=>x.id)})});update(r)}
function resolveNight(r){if(r.night.wolf&&r.night.guard!==r.night.wolf){let p=r.players.find(x=>x.id===r.night.wolf);if(p)p.alive=false}let w=win(r);if(w){r.winner=w;r.phase="finished"}else{r.phase="day";r.votes={}}update(r)}
io.on("connection",s=>{
s.on("room:create",({name})=>{name=String(name||"").trim().slice(0,12);if(!name)return s.emit("error:msg","名前を入力してください。");let c=code(),r={code:c,players:[],started:false,phase:"lobby",day:0,votes:{},night:{},winner:null};r.players.push({id:s.id,socket:s,name,host:true,alive:true,role:null});rooms.set(c,r);s.join(c);s.data.room=c;s.emit("room:joined",{code:c});update(r)});
s.on("room:join",({code:c,name})=>{c=String(c||"").trim().toUpperCase();name=String(name||"").trim().slice(0,12);let r=rooms.get(c);if(!name)return s.emit("error:msg","名前を入力してください。");if(!r)return s.emit("error:msg","そのルームはありません。");if(r.started)return s.emit("error:msg","ゲームはすでに始まっています。");if(r.players.length>=MAX)return s.emit("error:msg","満員です。");r.players.push({id:s.id,socket:s,name,host:false,alive:true,role:null});s.join(c);s.data.room=c;s.emit("room:joined",{code:c});update(r)});
s.on("game:start",()=>{let r=rooms.get(s.data.room);if(!r)return;let me=r.players.find(p=>p.id===s.id);if(!me?.host)return s.emit("error:msg","ホストだけが開始できます。");if(r.players.length<5)return s.emit("error:msg","5人以上で開始してください。");let roles=ROLES[r.players.length];shuffle(r.players).forEach((p,i)=>{p.role=roles[i];p.alive=true});r.started=true;r.winner=null;r.day=0;night(r)});
s.on("action:night",({action,targetId})=>{let r=rooms.get(s.data.room);if(!r||r.phase!=="night")return;let me=r.players.find(p=>p.id===s.id),t=r.players.find(p=>p.id===targetId);if(!me?.alive||!t?.alive||t.id===me.id)return;if(action==="wolf"&&me.role==="人狼")r.night.wolf=t.id;if(action==="seer"&&me.role==="占い師"){s.emit("action:result",{text:`${t.name}さんは${t.role==="人狼"?"人狼":"人狼ではありません"}。`});r.night.seer=t.id}if(action==="guard"&&me.role==="騎士")r.night.guard=t.id;let a=r.players.filter(p=>p.alive);if(a.filter(p=>p.role==="人狼").every(()=>r.night.wolf)&&a.filter(p=>p.role==="占い師").every(()=>r.night.seer)&&a.filter(p=>p.role==="騎士").every(()=>r.night.guard))resolveNight(r)});
s.on("action:vote",({targetId})=>{let r=rooms.get(s.data.room);if(!r||r.phase!=="day")return;let me=r.players.find(p=>p.id===s.id),t=r.players.find(p=>p.id===targetId);if(!me?.alive||!t?.alive||t.id===me.id)return;r.votes[me.id]=t.id;let a=r.players.filter(p=>p.alive);if(Object.keys(r.votes).length<a.length)return;let c={};Object.values(r.votes).forEach(id=>c[id]=(c[id]||0)+1);let m=Math.max(...Object.values(c)),top=Object.keys(c).filter(id=>c[id]===m);if(top.length===1){let out=r.players.find(p=>p.id===top[0]);if(out)out.alive=false}let w=win(r);if(w){r.winner=w;r.phase="finished";update(r)}else night(r)});
s.on("disconnect",()=>{let r=rooms.get(s.data.room);if(!r)return;let i=r.players.findIndex(p=>p.id===s.id);if(i>=0)r.players.splice(i,1);if(!r.players.length)return rooms.delete(r.code);if(!r.players.some(p=>p.host))r.players[0].host=true;update(r)})
});
server.listen(PORT,()=>console.log("Werewolf Online on "+PORT));