import assert from "node:assert/strict";
import { THREE } from "../scripts/3d/model-kit.js";
import { panCamera, facingYaw, affiliationColor } from "../scripts/3d/presentation.js";
import { layoutArchitecture } from "../scripts/3d/layout.js";

function project(state, point, width, height) {
  const half = 13 / state.zoom, camera = new THREE.OrthographicCamera(-half * width / height, half * width / height, half, -half, 0.1, 10000);
  camera.position.set(state.x + Math.sin(state.yaw) * Math.cos(state.elevation) * 150, state.y + Math.sin(state.elevation) * 150, state.z + Math.cos(state.yaw) * Math.cos(state.elevation) * 150);
  camera.lookAt(state.x, state.y, state.z); camera.updateMatrixWorld();
  const p = point.clone().project(camera); return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 };
}
let cases = 0;
for (const yaw of [-2.6, -1, 0, 0.18, 1.6, 3.1]) for (const elevation of [0.48, 0.75, 1.3]) for (const zoom of [0.35, 1, 2.5]) {
  const state = { x: 4, y: 2, z: -10, yaw, elevation, zoom }, point = new THREE.Vector3(2, -5, -6);
  const dx = -65, dy = 47, before = project(state, point, 1180, 570), after = project(panCamera(state, dx, dy, 570), point, 1180, 570);
  assert.ok(Math.abs(after.x - before.x - dx) < 1e-8);
  assert.ok(Math.abs(after.y - before.y - dy) < 1e-8);
  cases++;
}
assert.equal(facingYaw({x:0,z:0}, {x:1,z:0}), Math.PI / 2);
assert.equal(facingYaw({x:0,z:0}, null, 1.2), 1.2);
assert.equal(affiliationColor({owner:{color:'#e15782'},color:'#112233'}, 'ice'), '#e15782');
assert.equal(affiliationColor({color:'url(secret)'}, 'runner'), '#72bfcc');
assert.equal(affiliationColor({visual:{color:'#123abc'},owner:{color:'#e15782'}},'mini'),'#123abc');
assert.equal(affiliationColor({visual:{color:'red'},owner:{color:'#e15782'}},'mini'),'#e15782');
const owners = [{ref:'runner:a',color:'#aabbcc',progMinis:Array.from({length:7},(_,i)=>({ref:'prog:a:'+i}))}, {ref:'runner:b',progMinis:[{ref:'prog:b:armor'}]}];
const records = layoutArchitecture([{floorId:'f',row:1,column:1,participants:owners}])[0].entities;
for (const owner of records.filter(r=>r.kind==='runner')) for (const program of records.filter(r=>r.entity.ownerRef===owner.entity.ref)) {
  assert.ok(Math.hypot(program.x-owner.x,program.z-owner.z)<=3.401, 'program sits next to its actual owner');
  assert.ok(records.filter(r=>r.kind==='runner'&&r!==owner).every(other=>Math.hypot(program.x-other.x,program.z-other.z)>4));
}
console.log(`${cases} projected drag cases; owner colors, +Z facing and adjacent program clusters passed.`);
