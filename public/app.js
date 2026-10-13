'use strict';
const $=id=>document.getElementById(id);
const canvas=$('battlefield'),ctx=canvas.getContext('2d');
const W=1200,H=620;
const WEAPONS=[
 {id:'shell',label:'Shell',icon:'●'},
 {id:'heavy',label:'Heavy',icon:'◉'},
 {id:'triple',label:'Triple',icon:'⁖'},
 {id:'cluster',label:'Cluster',icon:'✹'},
 {id:'spider',label:'Spider',icon:'✳'},
 {id:'air',label:'Airstrike',icon:'✈'},
 {id:'nuke',label:'Nuke',icon:'☢'},
 {id:'laser',label:'Laser',icon:'⌁'},
 {id:'repair',label:'Repair',icon:'✚'},
 {id:'shield',label:'Shield',icon:'⬡'}
];
const SHOP=[
 {id:'repair',name:'Repair +35 HP',cost:100},
 {id:'refuel',name:'Refuel +45',cost:65},
 {id:'heavy',name:'Heavy shells ×2',cost:85},
 {id:'cluster',name:'Cluster ×2',cost:105},
 {id:'shield',name:'Forcefield ×1',cost:145},
 {id:'nuke',name:'Nuke ×1',cost:245}
];
let ws=null,playerId=null,room=null,connected=false,selectedWeapon='shell',targetX=600;
let lastMove=0,lastAim=0,noticeTimeout=null,toastTimeout=null;
let particles=[],trails=new Map(),seenEvents=new Set(),shake=0,gameClock=0,frameTime=0;
const cloudSeeds=[{x:100,y:104,s:1.2},{x:445,y:165,s:.84},{x:785,y:82,s:1.05},{x:1130,y:135,s:.73},{x:270,y:210,s:.55}];
let demoTerrain=Array.from({length:W+1},(_,x)=>Math.round(414+42*Math.sin(x/125)+19*Math.sin(x/44+.8)+13*Math.sin(x/234)));
let demoTanks=[{id:'sample1',name:'THE COMMANDER',color:'#cffa7e',hp:100,maxHp:100,angle:49,power:65,x:185,y:0},{id:'sample2',name:'RIVAL TANK',color:'#fa9f7a',hp:100,maxHp:100,angle:130,power:70,x:1020,y:0}];
demoTanks.forEach(p=>p.y=demoTerrain[p.x]-9);
const htmlEscape=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const me=()=>room?.players.find(p=>p.id===playerId);
const current=()=>room?.players.find(p=>p.id===room.turnId);
const isMyTurn=()=>room?.phase==='playing' && room.turnId===playerId && !room.shotInProgress && me()?.hp>0;
const msgSend=(type,extra={})=>{if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type,...extra}));return true;}toast('Not connected to the server.');return false;};
function toast(message){$('toast').textContent=message;$('toast').classList.add('shown');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('shown'),2600);}
function battleNotice(message){$('battleNotice').textContent=message;$('battleNotice').classList.add('visible');clearTimeout(noticeTimeout);noticeTimeout=setTimeout(()=>$('battleNotice').classList.remove('visible'),2700);}
function chatLine(name,text,system=false){
 const root=$('chatLog');const line=document.createElement('div');line.className=system?'chat-system':'chat-line';
 if(system)line.textContent=text;else{const tag=document.createElement('strong');tag.textContent=name+':';line.append(tag,document.createTextNode(' '+text));}
 root.appendChild(line);while(root.children.length>55)root.firstElementChild.remove();root.scrollTop=root.scrollHeight;
}
function joinFromURL(){const params=new URLSearchParams(location.search),code=params.get('room');if(code)$('joinCode').value=code.slice(0,6).toUpperCase();}
function connect(){
 const proto=location.protocol==='https:'?'wss:':'ws:';
 ws=new WebSocket(proto+'//'+location.host+'/ws');
 ws.addEventListener('open',()=>{connected=true;updateConnection(true);});
 ws.addEventListener('close',()=>{connected=false;updateConnection(false);if(playerId){battleNotice('Connection lost — refresh to reconnect.');toast('Disconnected from game server.');$('lobbyModal').hidden=false;room=null;playerId=null;updateUI();}});
 ws.addEventListener('error',()=>{connected=false;updateConnection(false);});
 ws.addEventListener('message',evt=>{let m;try{m=JSON.parse(evt.data);}catch{return;}onMessage(m);});
}
function updateConnection(up){$('connDot').classList.toggle('ok',up);$('connText').textContent=up?'SERVER ONLINE':'SERVER OFFLINE';}
function onMessage(m){
 switch(m.type){
  case 'joined':{
   playerId=m.playerId;localStorage.setItem('bb_lastname',$('playerName').value.trim());
   $('lobbyModal').hidden=true;$('roomCodeDisplay').textContent=m.code;$('copyRoom').disabled=false;$('shareButton').disabled=false;
   $('chatInput').disabled=false;$('sendChat').disabled=false;
   history.replaceState(null,'','/?room='+encodeURIComponent(m.code));chatLine(null,`Joined room ${m.code}.`,true);
   battleNotice(`Welcome to room ${m.code}!`);break;
  }
  case 'state': {
    const oldPhase=room?.phase;const oldTurn=room?.turnId;
    room=m;
    if(room.phase==='playing' && (oldPhase!=='playing'||oldTurn!==room.turnId)){selectedWeapon='shell';trails.clear();}
    for(const event of m.events||[])handleVisualEvent(event);
    updateUI();
    if(room.phase==='ended' && oldPhase!=='ended')showEndScreen();
    if(room.phase==='playing' && oldPhase==='ended')$('endModal').hidden=true;
    break;
  }
  case 'frame': {
   if(room){room.projectiles=m.projectiles;room.events=m.events;for(const event of m.events)handleVisualEvent(event);}break;
  }
  case 'aim': {
   const p=room?.players.find(x=>x.id===m.id);
   if(p){p.angle=m.angle;p.power=m.power;if(m.id===playerId){$('angle').value=m.angle;$('power').value=m.power;showAimValues();}}
   break;
  }
  case 'notice':chatLine(null,m.message,true);battleNotice(m.message);break;
  case 'chat':chatLine(m.name,m.text);break;
  case 'error':toast(m.message);break;
  case 'left':location.assign('/');break;
 }
}
function createRoom(){const name=$('playerName').value.trim()||'Commander';if(name.length>18)return toast('Name is too long.');msgSend('create',{name});}
function joinRoom(){const name=$('playerName').value.trim()||'Commander';const code=$('joinCode').value.trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code))return toast('Enter the 6-character room code.');msgSend('join',{name,code});}
function showAimValues(){$('angleVal').textContent=$('angle').value+'°';$('powerVal').textContent=$('power').value+'%';}
function sendAim(){if(!isMyTurn())return;let a=Number($('angle').value),p=Number($('power').value);
 const self=me();if(self){self.angle=a;self.power=p;}
 showAimValues();const time=Date.now();if(time-lastAim>50){msgSend('aim',{angle:a,power:p});lastAim=time;}}
function weaponAvailable(w){let num=me()?.ammo?.[w.id];return num===-1||num>0;}
function updateWeapons(){
 const parent=$('weaponButtons');parent.replaceChildren();const turn=isMyTurn();
 for(const w of WEAPONS){
  const count=me()?.ammo?.[w.id]??(w.id==='shell'?-1:0);
  const btn=document.createElement('button');btn.type='button';btn.className='weapon-btn'+(w.id===selectedWeapon?' selected':'');
  btn.disabled=!turn||count===0;btn.title=w.label;
  btn.innerHTML=`<span class="weapon-icon">${w.icon}</span><span class="weapon-name">${w.label}</span><span class="weapon-qty">${count===-1?'∞':count}</span>`;
  btn.addEventListener('click',()=>{selectedWeapon=w.id;updateWeapons();$('targetTag').hidden=w.id!=='air';});
  parent.appendChild(btn);
 }
}
function updateRoster(){
 const r=$('roster');r.replaceChildren();const players=room?.players||[];
 $('playersCount').textContent=players.filter(p=>p.connected).length+' / 5';
 if(!players.length){r.innerHTML='<div class="empty-roster">Your squad will appear here.</div>';return;}
 for(const p of players){
  const el=document.createElement('div');el.className='roster-item'+(p.hp<=0&&room.phase!=='lobby'?' dead-tank':'');
  const hp=room.phase==='lobby'?100:p.hp;
  el.innerHTML=`<span class="roster-mark" style="border-color:${p.color};color:${p.color}">✚</span><div class="roster-data"><div class="roster-name">${htmlEscape(p.name)} ${p.id===room.hostId?'<small class="host-crown">HOST</small>':''} ${p.id===playerId?'<small class="roster-me">YOU</small>':''}</div><div class="roster-meta">${room.phase==='lobby'?'READY TO DEPLOY':p.hp<=0?'DESTROYED':room.turnId===p.id?'● FIRING TURN':p.connected?'IN BATTLE':'OFFLINE'} · ${p.kills} KILLS</div><div class="roster-hp-track"><div class="roster-hp-fill" style="width:${hp}%;background:${hp<32?'#f79c79':p.color}"></div></div></div><div class="roster-stat"><strong>${room.phase==='lobby'?'100':p.hp}</strong>HP</div>`;
  r.appendChild(el);
 }
}
function updateShop(){const section=$('shopCard');section.hidden=room?.phase!=='playing';if(section.hidden)return;
 const p=me();$('creditNum').textContent=p?.credits||0;
 const el=$('shopItems');el.replaceChildren();
 for(const item of SHOP){const btn=document.createElement('button');btn.type='button';btn.className='shop-item';btn.disabled=!isMyTurn()||(p?.credits||0)<item.cost;btn.innerHTML=`<span>${item.name}</span><b>◈ ${item.cost}</b>`;btn.addEventListener('click',()=>msgSend('buy',{item:item.id}));el.appendChild(btn);}
}
function updateUI(){
 $('roomStatePill').textContent=room?.phase==='playing'?'LIVE MATCH':room?.phase==='lobby'?'IN LOBBY':room?.phase==='ended'?'FINISHED':'OFFLINE';
 $('roomCodeDisplay').textContent=room?.code||'— — — — — —';
 $('roundBadge').textContent='ROUND '+String(Math.max(1,room?.round||1)).padStart(2,'0');
 $('windValue').textContent=room?.phase==='playing'?Math.abs(room.wind):'—';
 $('windArrow').textContent=room?.wind<0?'←':'→';
 $('stageStatus').textContent=room?.phase==='lobby'?'WAITING FOR PLAYERS':room?.phase==='playing'?'DEATHMATCH LIVE':room?.phase==='ended'?'MATCH ENDED':'AWAITING DEPLOYMENT';
 $('stageTitle').textContent=room?.phase==='playing'?'SURVIVE THE CROSSFIRE':room?.phase==='ended'?'BATTLE COMPLETE':'PREPARE FOR IMPACT';
 $('controls').hidden=room?.phase!=='playing';
 const waiting=room?.phase==='lobby';$('waitingOverlay').hidden=!waiting;
 if(waiting){$('waitTitle').textContent='Waiting for commanders';$('waitSubtitle').textContent=`${room.players.length} / 5 players ready. Share code ${room.code} with your friends.`;}
 const host=room?.hostId===playerId;
 $('startButton').hidden=!room||(room.phase!=='lobby'&&room.phase!=='ended')||!host;
 $('startButton').disabled=(room?.players.filter(p=>p.connected).length||0)<2;
 $('startButton').innerHTML=(room?.phase==='ended'?'START REMATCH':'START DEATHMATCH')+' <span>→</span>';
 $('copyRoom').disabled=!room;$('shareButton').disabled=!room;
 updateRoster();
 if(room?.phase==='playing'){
  const p=me();if(p){$('angle').value=p.angle;$('power').value=p.power;showAimValues();}
  const active=isMyTurn();$('fireButton').disabled=!active;
  $('moveLeft').disabled=!active||p.fuel<1;$('moveRight').disabled=!active||p.fuel<1;
  $('fuelValue').textContent=Math.round(p.fuel);$('fuelFill').style.width=(100*p.fuel/85)+'%';
  $('driveHelp').textContent=active?'YOUR TURN: use ← → or buttons to drive. Fuel costs 2 per 8px.':room.shotInProgress?'Projectile in flight — wait for next turn.':`Waiting for ${current()?.name||'player'} to finish their turn.`;
  $('angle').disabled=!active;$('power').disabled=!active;
  $('controlTurn').textContent=active?'YOUR TURN — TAKE THE SHOT':room.shotInProgress?'PROJECTILES IN FLIGHT':`${current()?.name||'Player'} IS PLAYING`;
  if(!weaponAvailable(WEAPONS.find(w=>w.id===selectedWeapon)))selectedWeapon='shell';
  updateWeapons();updateShop();$('targetTag').hidden=!active||selectedWeapon!=='air';
 }
}
function showEndScreen(){
 const winner=room.players.find(p=>p.id===room.winnerId),ownWin=winner?.id===playerId;
 $('endHeadline').textContent=winner?(ownWin?'YOU WON!':'BATTLE OVER'):'DRAW!';
 $('endSub').textContent=winner?`${winner.name} is the last tank standing!`:'Nobody survived this deathmatch.';
 $('endStandings').replaceChildren();
 room.players.slice().sort((a,b)=>(b.hp>0)-(a.hp>0)||b.kills-a.kills||b.damage-a.damage).forEach((p,i)=>{
  const line=document.createElement('div');line.className='end-stat';line.innerHTML=`<span>${i+1}. ${htmlEscape(p.name)}</span><strong>${p.kills} KILLS · ${p.damage} DMG</strong>`;$('endStandings').appendChild(line);
 });
 $('playAgain').hidden=room.hostId!==playerId;$('hostRematchNote').hidden=room.hostId===playerId;
 $('endModal').hidden=false;
}
function fire(){if(!isMyTurn())return;
 if(selectedWeapon==='air' && !Number.isFinite(targetX))targetX=600;
 if(msgSend('fire',{weapon:selectedWeapon,targetX})){$('fireButton').disabled=true;$('targetTag').hidden=true;}
}
function handleVisualEvent(ev){
 if(seenEvents.has(ev.id))return;seenEvents.add(ev.id);if(seenEvents.size>100)seenEvents=new Set([...seenEvents].slice(-70));
 const color=ev.kind==='nuke'?'#ffdb8c':ev.kind==='laser'?'#a2ffec':'#ffd29b';
 if(ev.type==='laser'){for(let i=0;i<38;i++){const t=Math.random();spawnParticle(ev.x+(ev.x2-ev.x)*t,ev.y+(ev.y2-ev.y)*t,'#c4ffdd',5);}return;}
 const count=ev.kind==='nuke'?100:ev.kind==='heavy'?45:28;
 shake=Math.max(shake,ev.kind==='nuke'?17:ev.kind==='heavy'?8:4);
 for(let i=0;i<count;i++)spawnParticle(ev.x,ev.y,i%5?'#ffd398':color,ev.kind==='nuke'?10:6);
}
function spawnParticle(x,y,color,speed){
 const a=Math.random()*Math.PI*2,vel=(Math.random()*.9+.1)*speed*18;
 particles.push({x,y,vx:Math.cos(a)*vel,vy:Math.sin(a)*vel-35,life:random(.35,1.2),max:1.2,size:random(1.4,5.2),color});
 if(particles.length>450)particles.splice(0,particles.length-450);
}
function drawCloud(x,y,s){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle='#ffffff24';for(const [cx,cy,rx,ry] of [[0,0,60,13],[-35,1,29,10],[13,-10,32,20],[45,0,40,12]]){ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.fill();}ctx.restore();}
function drawSky(t){
 const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,'#3e6372');grad.addColorStop(.5,'#7c9b92');grad.addColorStop(.82,'#e0b58a');grad.addColorStop(1,'#d89973');ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
 const sun=ctx.createRadialGradient(970,155,10,970,155,210);sun.addColorStop(0,'#fce7b0a0');sun.addColorStop(1,'#ffdda400');ctx.fillStyle=sun;ctx.fillRect(720,0,480,430);
 ctx.fillStyle='#f8ddaa';ctx.beginPath();ctx.arc(971,165,55,0,Math.PI*2);ctx.fill();
 for(let i=0;i<cloudSeeds.length;i++){const c=cloudSeeds[i];drawCloud(c.x+Math.sin(t*.06+i)*22,c.y,c.s);}
 for(let layer=0;layer<3;layer++){
  const base=360+layer*57;ampDrawMountains(layer,base);
 }
 function ampDrawMountains(layer,base){
  ctx.beginPath();ctx.moveTo(0,H);
  for(let x=0;x<=W;x+=8){const y=base+Math.sin(x/(118+layer*29)+layer*3)*38+Math.sin(x/(51+layer*25)+layer*.8)*16+Math.sin(x/319+layer)*25;ctx.lineTo(x,y);}
  ctx.lineTo(W,H);ctx.closePath();ctx.fillStyle=['#627977','#557069','#466357'][layer];ctx.fill();
 }
 ctx.fillStyle='#f7e5af22';ctx.fillRect(0,295,W,4);
}
function drawTerrain(h){
 if(!h?.length)return;
 ctx.beginPath();ctx.moveTo(0,H);ctx.lineTo(0,h[0]);for(let x=2;x<=W;x+=2)ctx.lineTo(x,h[x]);ctx.lineTo(W,H);ctx.closePath();
 const ground=ctx.createLinearGradient(0,320,0,H);ground.addColorStop(0,'#4c6247');ground.addColorStop(.22,'#596143');ground.addColorStop(.37,'#61533c');ground.addColorStop(1,'#302d2a');ctx.fillStyle=ground;ctx.fill();
 ctx.beginPath();for(let x=0;x<=W;x+=2){if(x===0)ctx.moveTo(x,h[x]-2);else ctx.lineTo(x,h[x]-2);}ctx.strokeStyle='#afca77';ctx.lineWidth=5;ctx.stroke();
 ctx.beginPath();for(let x=0;x<=W;x+=3){if(x===0)ctx.moveTo(x,h[x]+5);else ctx.lineTo(x,h[x]+5);}ctx.strokeStyle='#829e63';ctx.lineWidth=6;ctx.stroke();
 ctx.save();ctx.beginPath();ctx.moveTo(0,H);ctx.lineTo(0,h[0]);for(let x=2;x<=W;x+=2)ctx.lineTo(x,h[x]);ctx.lineTo(W,H);ctx.closePath();ctx.clip();
 ctx.globalAlpha=.2;for(let i=0;i<125;i++){const x=(i*341)%W,y=370+((i*157)%250);ctx.beginPath();ctx.ellipse(x,y,(i%4)*2+2,(i%3)+1,0,0,7);ctx.fillStyle=i%2?'#1b2b2e':'#ad9470';ctx.fill();}ctx.restore();
 // Small grass blades, grounded to surface
 ctx.strokeStyle='#d2d68a77';ctx.lineWidth=1;
 for(let x=14;x<W;x+=29){const y=h[x];ctx.beginPath();ctx.moveTo(x,y-3);ctx.lineTo(x-2,y-8);ctx.moveTo(x,y-3);ctx.lineTo(x+2,y-7);ctx.stroke();}
}
function drawTank(p,active=false){
 if(p.hp<=0)return;
 const x=p.x,y=p.y;
 ctx.save();ctx.translate(x,y);
 const wobble=active?Math.sin(gameClock*2.4)*1.1:0;
 if(active){const glow=ctx.createRadialGradient(0,-12,10,0,-12,53);glow.addColorStop(0,p.color+'3d');glow.addColorStop(1,p.color+'00');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(0,-12,53,0,Math.PI*2);ctx.fill();}
 if(p.shield>0){ctx.strokeStyle='#a5eeff88';ctx.lineWidth=3;ctx.setLineDash([10,5]);ctx.beginPath();ctx.ellipse(0,-21,39,41,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
 // Cannon barrel — angle is measured counterclockwise from +x
 const a=p.angle*Math.PI/180;
 ctx.save();ctx.translate(0,-20);ctx.rotate(-a);
 const barrelGrad=ctx.createLinearGradient(0,-6,0,7);barrelGrad.addColorStop(0,'#e2e9be');barrelGrad.addColorStop(.38,p.color);barrelGrad.addColorStop(1,'#30463b');ctx.fillStyle=barrelGrad;
 ctx.fillRect(-5,-6,32,12);ctx.fillStyle='#263633';ctx.fillRect(25,-8,7,16);ctx.restore();
 // Main body and hatch
 ctx.fillStyle='#1f3335';ctx.beginPath();ctx.roundRect(-27,-8,55,16,7);ctx.fill();
 ctx.fillStyle=p.color;ctx.beginPath();ctx.moveTo(-25,-8);ctx.lineTo(-15,-27+wobble);ctx.lineTo(17,-26+wobble);ctx.lineTo(29,-8);ctx.closePath();ctx.fill();
 ctx.fillStyle='#243636';ctx.fillRect(-12,-32+wobble,24,7);ctx.fillStyle='#e8ffdb9c';ctx.fillRect(-10,-32+wobble,17,3);
 ctx.fillStyle='#263536';ctx.beginPath();ctx.roundRect(-30,0,61,18,9);ctx.fill();ctx.strokeStyle=p.color;ctx.lineWidth=2;ctx.stroke();
 for(let i=-20;i<24;i+=11){ctx.fillStyle='#738679';ctx.beginPath();ctx.arc(i,9,5,0,7);ctx.fill();ctx.fillStyle='#1f3232';ctx.beginPath();ctx.arc(i,9,2,0,7);ctx.fill();}
 ctx.restore();
 // Name plate and HP meter
 ctx.font='800 14px system-ui';ctx.textAlign='center';ctx.textBaseline='bottom';
 ctx.shadowColor='#07161f';ctx.shadowBlur=5;ctx.fillStyle='#fff';ctx.fillText(p.name,x,y-58);ctx.shadowBlur=0;
 ctx.fillStyle='#10262cbe';ctx.fillRect(x-31,y-52,62,6);
 ctx.fillStyle=p.hp<30?'#fa887d':p.color;ctx.fillRect(x-31,y-52,62*p.hp/(p.maxHp||100),6);
 if(active){ctx.strokeStyle='#f6ffa6';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-8,y-69);ctx.lineTo(x,y-61);ctx.lineTo(x+8,y-69);ctx.stroke();}
}
function drawAimArc(p,terrain,wind){if(!p||!terrain?.length)return;
 const a=p.angle*Math.PI/180,speed=180+p.power*4;
 let x=p.x+Math.cos(a)*21,y=p.y-17-Math.sin(a)*21,vx=Math.cos(a)*speed,vy=-Math.sin(a)*speed;
 ctx.save();ctx.fillStyle='#f9ffe6df';const dt=.065;
 for(let i=0;i<115;i++){vx+=wind*.85*dt;vy+=310*dt;x+=vx*dt;y+=vy*dt;
  if(x<0||x>W||y>H||y>=terrain[Math.max(0,Math.min(W,Math.round(x)))])break;
  if(i%3===0){ctx.globalAlpha=1-i/123;ctx.beginPath();ctx.arc(x,y,i<10?3:2.1,0,7);ctx.fill();}
 }
 ctx.restore();
}
function drawProjectiles(data){
 if(!data?.length){trails.clear();return;}
 const ids=new Set(data.map(p=>p.id));
 for(const id of trails.keys())if(!ids.has(id))trails.delete(id);
 for(const p of data){
  const tail=trails.get(p.id)||[];tail.push({x:p.x,y:p.y});if(tail.length>17)tail.shift();trails.set(p.id,tail);
  ctx.strokeStyle=p.kind==='nuke'?'#fce4a6':p.kind==='laser'?'#c4ffe7':'#fff1b3';ctx.lineWidth=p.kind==='nuke'?5:3;
  ctx.beginPath();tail.forEach((pt,i)=>{if(i===0)ctx.moveTo(pt.x,pt.y);else ctx.lineTo(pt.x,pt.y);});ctx.stroke();
  const r=p.kind==='nuke'?10:p.kind==='air'?6:4;
  ctx.shadowBlur=22;ctx.shadowColor='#ffeeb5';ctx.beginPath();ctx.arc(p.x,p.y,r,0,7);ctx.fillStyle=p.kind==='nuke'?'#ffe693':'#fff6d6';ctx.fill();ctx.shadowBlur=0;
 }
}
function drawParticles(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;if(p.life<=0){particles.splice(i,1);continue;}p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=170*dt;p.vx*=.992;ctx.globalAlpha=Math.max(0,Math.min(1,p.life/p.max*2));ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;}
function drawReticle(x,terrain){const y=Math.min(terrain[Math.max(0,Math.min(W,Math.round(x)))],H)-14;
 ctx.strokeStyle='#e7ffbb';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,18,0,7);ctx.moveTo(x-28,y);ctx.lineTo(x-11,y);ctx.moveTo(x+11,y);ctx.lineTo(x+28,y);ctx.moveTo(x,y-28);ctx.lineTo(x,y-11);ctx.moveTo(x,y+11);ctx.lineTo(x,y+28);ctx.stroke();
 ctx.fillStyle='#102a2daa';ctx.fillRect(x-29,y+31,58,20);ctx.font='900 11px system-ui';ctx.textAlign='center';ctx.fillStyle='#e4ffc3';ctx.fillText(Math.round(x)+'m',x,y+46);
}
function loop(timestamp){requestAnimationFrame(loop);const dt=Math.min(.045,Math.max(.001,(timestamp-frameTime)/1000||.016));frameTime=timestamp;gameClock+=dt;
 ctx.save();if(shake>.1){ctx.translate(random(-shake,shake),random(-shake,shake));shake*=.83;}
 drawSky(gameClock);
 const terrain=room?.terrain?.length?room.terrain:demoTerrain;
 drawTerrain(terrain);
 const tanks=room?.players?.length?room.players:demoTanks;
 const active=room?.phase==='playing'?room.turnId:'sample1';
 for(const p of tanks)drawTank(p,active===p.id);
 if(isMyTurn()&&selectedWeapon!=='air'){drawAimArc(me(),terrain,room.wind);}
 if(isMyTurn()&&selectedWeapon==='air')drawReticle(targetX,terrain);
 drawProjectiles(room?.projectiles);drawParticles(dt);ctx.restore();
 if(room?.phase==='playing'){
  const ms=room.shotInProgress?0:Math.max(0,(room.turnEndsAt||Date.now())-Date.now());
  const ss=Math.ceil(ms/1000);$('turnClock').textContent=room.shotInProgress?'•••':`0:${String(ss).padStart(2,'0')}`;
 }else $('turnClock').textContent='--:--';
}
function battlefieldX(e){const rect=canvas.getBoundingClientRect();return Math.max(30,Math.min(W-30,(e.clientX-rect.left)/rect.width*W));}
function handleKey(e){
 const focus=document.activeElement;if(focus?.tagName==='TEXTAREA'||(focus?.tagName==='INPUT'&&['text','search','number','password'].includes(focus.type)))return;
 if(!isMyTurn())return;
 const key=e.key.toLowerCase();
 if(['arrowup','arrowdown','arrowleft','arrowright','pageup','pagedown',' ','q','e','a','d','w','s'].includes(key))e.preventDefault();
 const t=Date.now();
 if(key==='arrowleft'||key==='arrowright'||key==='a'||key==='d'){
  if(t-lastMove>90){msgSend('move',{dir:(key==='arrowright'||key==='d')?1:-1});lastMove=t;}return;
 }
 if(key==='arrowup'||key==='arrowdown'||key==='w'||key==='s'){
  const a=$('angle');a.value=String(Math.min(175,Math.max(5,Number(a.value)+((key==='arrowup'||key==='w')?2:-2))));sendAim();return;
 }
 if(key==='pageup'||key==='pagedown'){
  const p=$('power');p.value=String(Math.min(100,Math.max(10,Number(p.value)+(key==='pageup'?2:-2))));sendAim();return;
 }
 if(key==='q'||key==='e'){
  let i=WEAPONS.findIndex(w=>w.id===selectedWeapon);
  for(let j=0;j<WEAPONS.length;j++){i=(i+(key==='e'?1:-1)+WEAPONS.length)%WEAPONS.length;if(weaponAvailable(WEAPONS[i]))break;}
  selectedWeapon=WEAPONS[i].id;updateWeapons();$('targetTag').hidden=selectedWeapon!=='air';return;
 }
 if(key===' ')fire();
}
function events(){
 $('playerName').value=localStorage.getItem('bb_lastname')||'';joinFromURL();
 $('createRoom').addEventListener('click',createRoom);$('joinRoom').addEventListener('click',joinRoom);
 $('playerName').addEventListener('keydown',e=>{if(e.key==='Enter')createRoom();});
 $('joinCode').addEventListener('keydown',e=>{if(e.key==='Enter')joinRoom();});
 $('joinCode').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''));
 $('startButton').addEventListener('click',()=>msgSend(room?.phase==='ended'?'restart':'start'));
 $('playAgain').addEventListener('click',()=>msgSend('restart'));
 $('angle').addEventListener('input',sendAim);$('power').addEventListener('input',sendAim);
 for(const range of [$('angle'),$('power')])range.addEventListener('pointerup',()=>range.blur());
 $('fireButton').addEventListener('click',fire);
 $('moveLeft').addEventListener('click',()=>{if(isMyTurn())msgSend('move',{dir:-1});});
 $('moveRight').addEventListener('click',()=>{if(isMyTurn())msgSend('move',{dir:1});});
 for(const btn of [$('moveLeft'),$('moveRight')]){let timer=null;const dir=btn.id==='moveLeft'?-1:1;btn.addEventListener('pointerdown',()=>{if(!isMyTurn())return;timer=setInterval(()=>msgSend('move',{dir}),125);});for(const name of ['pointerup','pointercancel','pointerleave','blur'])btn.addEventListener(name,()=>{if(timer){clearInterval(timer);timer=null;}});}
 $('copyRoom').addEventListener('click',()=>copy(room?.code||''));
 $('shareButton').addEventListener('click',()=>copy(location.origin+'/?room='+room?.code));
 $('chatForm').addEventListener('submit',e=>{e.preventDefault();const v=$('chatInput').value.trim();if(!v)return;msgSend('chat',{text:v});$('chatInput').value='';});
 canvas.addEventListener('pointermove',e=>{if(isMyTurn()&&selectedWeapon==='air')targetX=battlefieldX(e);});
 canvas.addEventListener('pointerdown',e=>{if(!isMyTurn())return;
  if(selectedWeapon==='air'){targetX=battlefieldX(e);toast('Target locked. Press FIRE to call the airstrike.');return;}
  const p=me();const rect=canvas.getBoundingClientRect();let x=(e.clientX-rect.left)/rect.width*W,y=(e.clientY-rect.top)/rect.height*H;
  const a=Math.atan2(-(y-(p.y-17)),x-p.x)*180/Math.PI;if(a>=5&&a<=175){$('angle').value=Math.round(a);sendAim();}
 });
 window.addEventListener('keydown',handleKey);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)document.activeElement?.blur?.();});
}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Copied to clipboard!');}catch{toast('Clipboard unavailable — copy the room code shown above.');}}
events();connect();updateUI();requestAnimationFrame(loop);
