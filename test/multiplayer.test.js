'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
process.env.PORT='0';
const {server,rooms,stop}=require('../server.js');

async function connect(port){
 const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);
 await once(ws,'open');
 const queue=[];
 ws.addEventListener('message',e=>{try{queue.push(JSON.parse(e.data));}catch{}});
 ws.messages=queue;
 ws.sendJSON=(type,props={})=>ws.send(JSON.stringify({type,...props}));
 return ws;
}
async function until(ws,pred,timeout=1600){
 const start=Date.now();
 while(Date.now()-start<timeout){let i=ws.messages.findIndex(pred);if(i>=0)return ws.messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,12));}
 throw Error('Timeout waiting for message. Received: '+JSON.stringify(ws.messages.map(m=>m.type)));
}

test('create, join, cap 5, synchronize turns, enforce authorization', async t=>{
 if(!server.listening)await once(server,'listening');
 const port=server.address().port;
 let res=await fetch(`http://127.0.0.1:${port}/health`);assert.equal(res.status,200);
 const c=[];
 try{
  c.push(await connect(port));c[0].sendJSON('create',{name:'Host'});
  const join=await until(c[0],m=>m.type==='joined');assert.match(join.code,/^[A-F0-9]{6}$/);
  const code=join.code;
  for(let i=1;i<5;i++){
   const client=await connect(port);c.push(client);
   client.sendJSON('join',{name:'Friend '+i,code});
   const got=await until(client,m=>m.type==='joined');assert.equal(got.code,code);
  }
  const overflow=await connect(port);c.push(overflow);
  overflow.sendJSON('join',{name:'Sixth',code});
  const rejection=await until(overflow,m=>m.type==='error');assert.match(rejection.message,/full/);
  assert.equal(rooms.get(code).players.length,5);
  c[1].sendJSON('start');assert.match((await until(c[1],m=>m.type==='error')).message,/host/);
  c[0].sendJSON('start');
  await until(c[0],m=>m.type==='state'&&m.phase==='playing');
  assert.equal(rooms.get(code).players.filter(p=>p.hp>0).length,5);
  assert.equal(rooms.get(code).terrain.length,1201);
  const active=rooms.get(code).players[rooms.get(code).turnIndex];
  const activeConn=c[rooms.get(code).players.findIndex(p=>p.id===active.id)];
  const otherConn=c[rooms.get(code).players.findIndex(p=>p.id!==active.id)];
  const oldCredits=rooms.get(code).players.find(p=>p.id===otherConn.messages.find(m=>m.type==='joined')?.playerId)?.credits;
  otherConn.sendJSON('fire',{weapon:'nuke'});assert.match((await until(otherConn,m=>m.type==='error'&&m.message.includes('turn'))).message,/turn/);
  const originalX=active.x,originalFuel=active.fuel;
  activeConn.sendJSON('move',{dir:1});
  await until(c[0],m=>m.type==='state'&&m.phase==='playing'&&m.players.find(x=>x.id===active.id)?.x!==originalX);
  assert.equal(active.x,originalX+8);
  assert.ok(active.fuel<originalFuel);
  const beforeOther=active.x;
  otherConn.sendJSON('move',{dir:-1});
  await new Promise(r=>setTimeout(r,80));
  assert.equal(active.x,beforeOther);
  activeConn.sendJSON('aim',{angle:55,power:74});
  await until(c[0],m=>m.type==='aim'&&m.id===active.id);
  assert.equal(active.power,74);
  activeConn.sendJSON('fire',{weapon:'heavy'});
  await until(c[0],m=>m.type==='state'&&m.shotInProgress===true);
  assert.equal(active.ammo.heavy,2);
  await until(c[1],m=>m.type==='frame',2000);
  assert.equal(rooms.get(code).projectiles.length>0,true);
  const rr=await fetch(`http://127.0.0.1:${port}/app.js`);assert.equal(rr.status,200);
  const body=await rr.text();assert.ok(body.includes('drawTerrain'));
 }finally{
  for(const ws of c)try{ws.close();}catch{}
  stop();
 }
});
