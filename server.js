'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const W = 1200, H = 620, MAX_PLAYERS = 5, TURN_MS = 40000;
const COLORS = ['#8de078', '#ff9c78', '#79cfff', '#f5d174', '#d99cff'];
const WEAPONS = {
  shell:   {name:'Standard shell', count:-1, damage:44, radius:68},
  heavy:   {name:'Heavy cannon',   count:3,  damage:69, radius:89},
  triple:  {name:'Triple shot',    count:3,  damage:31, radius:54},
  cluster: {name:'Cluster bomb',   count:2,  damage:32, radius:49},
  spider:  {name:'Spider bomb',    count:2,  damage:28, radius:46},
  air:     {name:'Air strike',     count:2,  damage:39, radius:66},
  nuke:    {name:'Tactical nuke',  count:1,  damage:104,radius:145},
  laser:   {name:'Laser beam',     count:2,  damage:54, radius:42},
  repair:  {name:'Repair kit',     count:2,  damage:0,  radius:0},
  shield:  {name:'Forcefield',     count:1,  damage:0,  radius:0}
};
const SHOP = {
  repair: {title:'Repair +35 HP', cost:100},
  refuel: {title:'Refuel +45', cost:65},
  heavy: {title:'Heavy shells ×2', cost:85},
  cluster:{title:'Cluster bombs ×2', cost:105},
  shield:{title:'Forcefield ×1', cost:145},
  nuke:  {title:'Tactical nuke ×1', cost:245}
};
const rooms = new Map();
const random = (min,max) => Math.random() * (max-min)+min;
const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
const round = (n) => Math.round(n*10)/10;
const send = (c, obj) => { if (c && !c.closed) try { c.send(JSON.stringify(obj)); } catch {} };
function broadcast(room,obj) { for (const p of room.players) send(p.conn,obj); }
function err(conn,message){send(conn,{type:'error',message});}
function notice(room,message){broadcast(room,{type:'notice',message});}
function codeForRoom(){ let code;do{code=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(rooms.has(code));return code; }
function terrainGenerate(){
  const offset = random(-200,200), a = random(24,48), b = random(12,24);
  const heights=[];
  for(let x=0;x<=W;x++) heights.push(Math.round(clamp(408 + a*Math.sin(x/103+offset)+ b*Math.sin(x/43+offset*.2) + 18*Math.sin(x/201 + offset*.04),335,492)));
  return heights;
}
function createPlayer(conn,name){return {
 id:crypto.randomUUID(),name:String(name||'Commander').trim().slice(0,18).replace(/[<>]/g,'')||'Commander',
 conn, color:'', x:0,y:0,hp:100,maxHp:100,shield:0,fuel:75,credits:220,
 angle:55,power:68,kills:0,damage:0,ammo:{},connected:true
};}
function publicPlayer(p){ return {id:p.id,name:p.name,color:p.color,x:round(p.x),y:round(p.y),hp:p.hp,maxHp:p.maxHp,shield:p.shield,fuel:round(p.fuel),credits:p.credits,angle:p.angle,power:p.power,kills:p.kills,damage:p.damage,ammo:p.ammo,connected:p.connected}; }
function roomState(room, includeTerrain=true){return {type:'state',code:room.code,hostId:room.hostId,phase:room.phase,turnId:room.players[room.turnIndex]?.id||null,turnEndsAt:room.turnEndsAt||0,wind:room.wind,round:room.round,players:room.players.map(publicPlayer),terrain:includeTerrain?room.terrain:undefined,projectiles:room.projectiles.map(smallProj),events:room.events,shotInProgress:room.shotInProgress,winnerId:room.winnerId};}
function smallProj(p){return {id:p.id,x:round(p.x),y:round(p.y),kind:p.kind};}
function sync(room){broadcast(room,roomState(room));}
function playerInRoom(conn){const r=conn.room && rooms.get(conn.room);return [r,r?.players.find(p=>p.id===conn.playerId)];}
function adjustColors(room){room.players.forEach((p,i)=>p.color=COLORS[i]);}
function assignTurn(room, idx, announcement=true){
 if(room.phase!=='playing')return;
 let next=idx;
 for(let i=0;i<room.players.length;i++){
   let j=(next+i)%room.players.length;
   if(room.players[j]?.hp>0 && room.players[j].connected){next=j;break;}
 }
 room.turnIndex=next; room.turnEndsAt=Date.now()+TURN_MS; room.wind=Math.round(random(-13,13));room.shotInProgress=false;
 const p=room.players[next];
 if(p){p.fuel=Math.min(85,p.fuel+15);if(announcement)notice(room,`${p.name}'s turn`);}
 sync(room);
}
function winnerCheck(room){
 const alive=room.players.filter(p=>p.hp>0&&p.connected);
 if(room.phase!=='playing') return true;
 if(alive.length>1) return false;
 room.phase='ended';room.winnerId=alive[0]?.id||null;room.shotInProgress=false;
 notice(room,alive.length?`🏆 ${alive[0].name} wins the deathmatch!`:'Match ended — no surviving tanks.');sync(room);return true;
}
function nextTurn(room){if(winnerCheck(room))return;assignTurn(room,(room.turnIndex+1)%room.players.length);}
function initMatch(room){
 room.terrain=terrainGenerate();room.phase='playing';room.round++;room.events=[];room.projectiles=[];room.shotInProgress=false;room.winnerId=null;
 const spots=[110,355,600,845,1090];
 const n=room.players.length;
 const positions= n===2?[175,1025]:n===3?[155,600,1045]:n===4?[120,425,775,1080]:spots;
 room.players.forEach((p,i)=>{
   const x=positions[i]+random(-15,15); p.x=Math.round(x);p.y=room.terrain[p.x]-9;
   p.hp=100;p.maxHp=100;p.shield=0;p.fuel=75;p.credits=220;p.kills=0;p.damage=0;
   p.angle=i<n/2?random(40,66)|0:random(114,143)|0;p.power=68;
   p.ammo=Object.fromEntries(Object.entries(WEAPONS).map(([key,v])=>[key,v.count]));
 });
 room.turnIndex=Math.floor(random(0,n));assignTurn(room,room.turnIndex,false);
 notice(room,'Deathmatch started! Last tank standing wins.');
}
function damageTanks(room,ex,ey,radius,maxDamage,ownerId){
 let attacker=room.players.find(p=>p.id===ownerId);
 for(const p of room.players){
   if(p.hp<=0)continue;
   const d=Math.hypot(p.x-ex,p.y-13-ey);
   if(d>radius+12) continue;
   let dmg=Math.max(0,Math.round(maxDamage* Math.pow(1-clamp(d/(radius+12),0,1),0.70)));
   if(dmg<1)continue;
   if(p.shield>0){ const block=Math.min(dmg,p.shield);p.shield-=block;dmg-=block; }
   if(dmg>0){let taken=Math.min(p.hp,dmg);p.hp-=taken;p.damage= Math.max(0,p.damage);
      if(attacker && attacker.id!==p.id){attacker.credits+=Math.round(taken*.9);attacker.damage+=taken;if(p.hp<=0){attacker.kills++;attacker.credits+=75;}}
   }
 }
}
function explosion(room,x,y,radius,damage,ownerId,kind='shell',carve=true){
 x=clamp(x,0,W);y=clamp(y,5,H-8);
 room.events.push({id:++room.eventSeq,type:'boom',x:round(x),y:round(y),radius,kind,t:Date.now()});
 if(room.events.length>24) room.events.splice(0,room.events.length-24);
 if(carve){
   for(let xi=Math.max(0,Math.floor(x-radius*.85));xi<=Math.min(W,Math.ceil(x+radius*.85));xi++){
     const d=Math.abs(xi-x)/(radius*.85);
     const depth=radius*.50*Math.sqrt(Math.max(0,1-d*d));
     room.terrain[xi]=Math.min(H-25,Math.round(room.terrain[xi]+depth));
   }
 }
 damageTanks(room,x,y,radius,damage,ownerId);
 for(const p of room.players){ if(p.hp>0){p.y=room.terrain[Math.round(p.x)]-9;} }
}
let projId=0;
function makeProjectile(room,owner,x,y,vx,vy,kind,scale=1){
 room.projectiles.push({id:++projId,ownerId:owner.id,x,y,vx,vy,kind,scale,age:0,split:false});
}
function projectileSpec(kind,scale){const w=WEAPONS[kind]||WEAPONS.shell;return {damage:w.damage*scale,radius:w.radius*Math.sqrt(scale)};}
function impact(room,p,x,y){
 const {damage,radius}=projectileSpec(p.kind,p.scale);
 explosion(room,x,y,radius,damage,p.ownerId,p.kind);
 if(p.kind==='spider' && p.scale===1){
   const owner=room.players.find(pl=>pl.id===p.ownerId);
   if(owner){for(let i=0;i<5;i++) makeProjectile(room,owner,x,y-9,(i-2)*120,-random(140,260),'spider',.35);}
 }
}
function startShot(room,p,kind,targetX){
 const power=p.power, angle=p.angle*Math.PI/180;
 const speed=180+power*4, ox=p.x+Math.cos(angle)*21,oy=p.y-17-Math.sin(angle)*21;
 room.shotInProgress=true;room.turnEndsAt=0; room.lastShooterId=p.id;
 p.ammo[kind]=p.ammo[kind]===-1?-1:p.ammo[kind]-1;
 if(kind==='repair') {p.hp=Math.min(p.maxHp,p.hp+37);notice(room,`${p.name} repaired their tank (+37 HP).`);endShotDelayed(room);return;}
 if(kind==='shield') {p.shield=Math.min(100,p.shield+55);notice(room,`${p.name} activated a forcefield (+55).`);endShotDelayed(room);return;}
 if(kind==='air'){
   const x=clamp(Number.isFinite(targetX)?targetX:p.x+Math.cos(angle)*230,60,W-60);
   const order=Array.from({length:5},(_,i)=>i);
   for(const i of order) makeProjectile(room,p,clamp(x+(i-2)*30,7,W-7),-70-i*44,random(-5,5),random(45,85),'air',.72);
 }else if(kind==='laser'){
   const dx=Math.cos(angle),dy=-Math.sin(angle);let hitX=ox,hitY=oy;
   for(let i=0;i<1700;i+=4){const x=ox+dx*i, y=oy+dy*i;
     if(x<0||x>W||y>H||y<0 && i>70){hitX=clamp(x,0,W);hitY=clamp(y,0,H);break;}
     const tank=room.players.find(q=>q.hp>0 && q.id!==p.id && Math.abs(q.x-x)<17 && Math.abs(q.y-12-y)<14);
     if(tank||y>=room.terrain[Math.round(clamp(x,0,W))]){hitX=x;hitY=y;break;}
     hitX=x;hitY=y;
   }
   room.events.push({id:++room.eventSeq,type:'laser',x:ox,y:oy,x2:hitX,y2:hitY,t:Date.now(),kind});
   explosion(room,hitX,hitY,WEAPONS.laser.radius,WEAPONS.laser.damage,p.id,'laser');endShotDelayed(room);return;
 }else if(kind==='triple'){
   for(const delta of [-0.105,0,0.105])makeProjectile(room,p,ox,oy,Math.cos(angle+delta)*speed,-Math.sin(angle+delta)*speed,'triple');
 }else{
   makeProjectile(room,p,ox,oy,Math.cos(angle)*speed,-Math.sin(angle)*speed,kind);
 }
 notice(room,`${p.name} fired ${WEAPONS[kind].name}!`);sync(room);
}
function endShotDelayed(room){
 sync(room);
 room.resolveAt=Date.now()+1200;
}
function tick(room){
 if(room.phase!=='playing')return;
 if(!room.shotInProgress){
   if(Date.now()>room.turnEndsAt && room.turnEndsAt){notice(room,`${room.players[room.turnIndex]?.name||'Player'} ran out of time.`);nextTurn(room);}
   return;
 }
 if(!room.projectiles.length){if(room.resolveAt&&Date.now()>=room.resolveAt){room.resolveAt=0;nextTurn(room);}return;}
 const dt=.04,alive=[];
 for(const p of room.projectiles){
   p.vx+=room.wind*.85*dt;p.vy+=310*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.age+=dt;
   if(p.kind==='cluster'&&p.scale===1&&!p.split&&p.vy>25){p.split=true;const owner=room.players.find(q=>q.id===p.ownerId);
       if(owner){for(let j=0;j<5;j++)makeProjectile(room,owner,p.x,p.y,(j-2)*98+p.vx*.42,-random(80,175),'cluster',.62);}
       continue;
   }
   if(p.x<-35||p.x>W+35||p.y>H+20||p.age>14)continue;
   if(p.y<-50){alive.push(p);continue;}
   const tank=room.players.find(q=>q.hp>0 && q.id!==p.ownerId && Math.abs(q.x-p.x)<17 && Math.abs((q.y-13)-p.y)<15);
   if(tank ||(p.x>=0&&p.x<=W&&p.y>=room.terrain[Math.round(p.x)])){
     impact(room,p,p.x,Math.min(p.y,H-12));continue;
   }
   alive.push(p);
 }
 // Projectiles produced during impacts are appended to room.projectiles; retain them.
 const spawned=room.projectiles.filter(p=>p.age===0);
 room.projectiles=alive.concat(spawned);
 if(room.projectiles.length===0){endShotDelayed(room);}
 broadcast(room,{type:'frame',projectiles:room.projectiles.map(smallProj),events:room.events});
 // Impact may change HP and geometry — synchronize immediately.
 if(room.events.length && room.events[room.events.length-1].id!==room.lastSyncedEvent){room.lastSyncedEvent=room.events[room.events.length-1].id;sync(room);}
}
function handleMessage(c,data){
 let msg;try{msg=JSON.parse(data);}catch{return err(c,'Invalid message');}
 if(!msg||typeof msg!=='object')return;
 if(msg.type==='create'){
   if(c.room) return err(c,'You are already in a room');
   const player=createPlayer(c,msg.name),code=codeForRoom();
   const room={code,players:[player],hostId:player.id,phase:'lobby',terrain:[],turnIndex:0,turnEndsAt:0,wind:0,round:0,events:[],eventSeq:0,projectiles:[],shotInProgress:false,winnerId:null};
   rooms.set(code,room);player.color=COLORS[0];c.room=code;c.playerId=player.id;
   send(c,{type:'joined',playerId:player.id,code});sync(room);return;
 }
 if(msg.type==='join'){
   if(c.room)return err(c,'You are already in a room');
   const code=String(msg.code||'').trim().toUpperCase();const room=rooms.get(code);
   if(!room)return err(c,'Room not found. Check the room code.');
   if(room.phase!=='lobby')return err(c,'This match has already started.');
   if(room.players.length>=MAX_PLAYERS)return err(c,'Room is full (max 5 players).');
   const p=createPlayer(c,msg.name);room.players.push(p);c.room=room.code;c.playerId=p.id;adjustColors(room);
   send(c,{type:'joined',playerId:p.id,code});notice(room,`${p.name} joined the room.`);sync(room);return;
 }
 if(msg.type==='leave'){closeRoomMember(c);send(c,{type:'left'});return;}
 const [room,p]=playerInRoom(c);if(!room||!p)return err(c,'Join a room first.');
 switch(msg.type){
  case 'start':case 'restart':
   if(room.hostId!==p.id)return err(c,'Only the host can start a match.');
   if(msg.type==='start'&&room.phase!=='lobby'||msg.type==='restart'&&room.phase!=='ended')return err(c,'Cannot start right now.');
   if(room.players.filter(q=>q.connected).length<2)return err(c,'At least 2 players required.');
   room.players=room.players.filter(q=>q.connected);adjustColors(room);initMatch(room);break;
  case 'aim': {
   if(room.phase!=='playing'||room.shotInProgress||room.players[room.turnIndex]?.id!==p.id||p.hp<=0)return;
   if(Number.isFinite(msg.angle))p.angle=Math.round(clamp(msg.angle,5,175));
   if(Number.isFinite(msg.power))p.power=Math.round(clamp(msg.power,10,100));
   broadcast(room,{type:'aim',id:p.id,angle:p.angle,power:p.power});break;
  }
  case 'move': {
   if(room.phase!=='playing'||room.shotInProgress||room.players[room.turnIndex]?.id!==p.id||p.hp<=0)return;
   const val=Number(msg.dir);if(!Number.isFinite(val))return;
   const dir=Math.sign(val);if(!dir||p.fuel<1)return;
   const nextX=Math.round(clamp(p.x+dir*8,28,W-28));
   if(room.players.some(q=>q.id!==p.id&&q.hp>0&&Math.abs(q.x-nextX)<35))return;
   const nextY=room.terrain[nextX]-9;
   if(Math.abs(nextY-p.y)>23)return;
   const delta=Math.abs(nextX-p.x);
   if(!delta)return;
   p.x=nextX;p.y=nextY;p.fuel=round(Math.max(0,p.fuel-delta*.25));sync(room);break;
  }
  case 'fire': {
   if(room.phase!=='playing'||room.shotInProgress||room.players[room.turnIndex]?.id!==p.id||p.hp<=0)return err(c,'Wait for your turn.');
   const kind=typeof msg.weapon==='string'?msg.weapon:'shell';
   if(!(kind in WEAPONS))return err(c,'Unknown weapon.');
   if(p.ammo[kind]===0)return err(c,'Out of ammo. Buy more from the shop.');
   startShot(room,p,kind,clamp(Number(msg.targetX),30,W-30));break;
  }
  case 'buy':{
   if(room.phase!=='playing'||room.shotInProgress||room.players[room.turnIndex]?.id!==p.id||p.hp<=0)return err(c,'Shop opens on your turn.');
   const key=String(msg.item||'');const item=SHOP[key];if(!item)return err(c,'Unknown item.');
   if(p.credits<item.cost)return err(c,'Not enough credits.');
   if(key==='repair'&&p.hp===p.maxHp)return err(c,'Your health is full.');
   if(key==='refuel'&&p.fuel>=85)return err(c,'Fuel is already full.');
   p.credits-=item.cost;
   if(key==='repair')p.hp=Math.min(p.maxHp,p.hp+35);
   else if(key==='refuel')p.fuel=Math.min(85,p.fuel+45);
   else p.ammo[key]+=(key==='heavy'||key==='cluster'?2:1);
   notice(room,`${p.name} purchased ${item.title}.`);sync(room);break;
  }
  case 'chat':{
   const t=String(msg.text||'').trim().slice(0,140);if(!t)return;
   if(!c.lastChat||Date.now()-c.lastChat>700){c.lastChat=Date.now();broadcast(room,{type:'chat',id:p.id,name:p.name,text:t});}break;
  }
 }
}
function closeRoomMember(c){
 if(!c.room)return;
 const room=rooms.get(c.room);if(!room){c.room=null;c.playerId=null;return;}
 const index=room.players.findIndex(p=>p.id===c.playerId);
 if(index<0)return;
 const p=room.players[index];p.connected=false;p.conn=null;
 const oldHost=room.hostId;
 if(room.phase==='lobby'||room.phase==='ended')room.players.splice(index,1);
 else if(room.phase==='playing')p.hp=0;
 if(oldHost===p.id)room.hostId=room.players.find(q=>q.connected)?.id||null;
 if(room.players.filter(q=>q.connected).length===0){rooms.delete(room.code);}
 else{
   notice(room,`${p.name} left the room.`);
   if(room.phase==='playing'){
     if(!winnerCheck(room)&&room.players[room.turnIndex]?.id===p.id){room.projectiles=[];nextTurn(room);}
   }
   sync(room);
 }
 c.room=null;c.playerId=null;
}

// Small dependency-free WebSocket endpoint (RFC 6455): browser compatible, text frames only.
class WSConnection {
 constructor(socket){this.socket=socket;this.buffer=Buffer.alloc(0);this.closed=false;this.room=null;this.playerId=null;
   socket.on('data',buf=>this.onData(buf));socket.on('close',()=>this.onClose());socket.on('error',()=>this.onClose());}
 send(text,opcode=1){if(this.closed)return;
   const data=Buffer.from(text),head=data.length<126?Buffer.from([0x80|opcode,data.length]):Buffer.from([0x80|opcode,126,data.length>>8,data.length&255]);
   this.socket.write(Buffer.concat([head,data]));}
 onData(buf){this.buffer=Buffer.concat([this.buffer,buf]);if(this.buffer.length>262144){this.socket.destroy();return;}
  while(this.buffer.length>=2){
   const b0=this.buffer[0],b1=this.buffer[1],op=b0&0xf,masked=!!(b1&128);let size=b1&127,idx=2;
   if(size===126){if(this.buffer.length<4)return;size=this.buffer.readUInt16BE(2);idx=4;}
   else if(size===127){if(this.buffer.length<10)return;const hi=this.buffer.readUInt32BE(2);if(hi>0){this.socket.destroy();return;}size=this.buffer.readUInt32BE(6);idx=10;}
   if(size>65536||!masked){this.socket.destroy();return;}
   if(this.buffer.length<idx+4+size)return;
   const mask=this.buffer.subarray(idx,idx+4),data=this.buffer.subarray(idx+4,idx+4+size);
   for(let i=0;i<size;i++)data[i]^=mask[i%4];
   this.buffer=this.buffer.subarray(idx+4+size);
   if(op===8){this.socket.end();this.onClose();return;}
   if(op===9){this.send(data.toString('utf8'),10);continue;}
   if(op===1 && (b0&128))handleMessage(this,data.toString('utf8'));
   else if(op!==10){this.socket.destroy();return;}
  }
 }
 onClose(){if(this.closed)return;this.closed=true;closeRoomMember(this);}
}
const STATIC=path.join(__dirname,'public');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400).end();return;}
  if(pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));return;}
  const file=path.join(STATIC,pathname==='/'?'index.html':pathname);
  if(!file.startsWith(STATIC+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,body)=>{
    if(error){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(body);
  });
});
server.on('upgrade',(req,socket,head)=>{
 if(req.url!=='/ws'||req.headers.upgrade?.toLowerCase()!=='websocket'||!req.headers['sec-websocket-key']){socket.destroy();return;}
 const key=req.headers['sec-websocket-key'];
 if(!/^[A-Za-z0-9+/]{22}==$/.test(key)){socket.destroy();return;}
 const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
 const conn=new WSConnection(socket);if(head?.length)conn.onData(head);
});
const interval=setInterval(()=>{for(const room of rooms.values())tick(room);},40);
server.listen(PORT,'0.0.0.0',()=>console.log(`Big Battle Online → http://localhost:${PORT}`));
function stop(){clearInterval(interval);server.close();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
module.exports={server,rooms,WEAPONS,SHOP,stop};
