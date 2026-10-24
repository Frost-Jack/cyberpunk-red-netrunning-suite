import assert from "node:assert/strict";
import { test } from "node:test";
import { THREE } from "../scripts/3d/model-kit.js";
import { createAttackEffects } from "../scripts/3d/attack-effects.js";
import { PROGRAM_INFO } from "../scripts/constants.js";

const from = new THREE.Vector3(8, -3, 11), to = new THREE.Vector3(-4, 7, 2);
const event = (key = "hellbolt", hit = true) => ({ key, from, to, hit });
const close = (actual, expected) => assert.ok(new THREE.Vector3(...actual).distanceTo(expected) < 1e-6,
  `${actual} must equal ${expected.toArray()}`);
function watchResources(group) {
  const geometries = new Set(), materials = new Set(), counts = new Map();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) {
      assert.equal(object.material.depthTest, true); assert.equal(object.material.depthWrite, false);
      materials.add(object.material);
    }
    if (object.isPoints) assert.ok(object.geometry.getAttribute("position").count <= 32);
  });
  for (const resource of [...geometries, ...materials]) {
    counts.set(resource, 0);
    resource.addEventListener("dispose", () => counts.set(resource, counts.get(resource) + 1));
  }
  return () => { for (const count of counts.values()) assert.equal(count, 1, "every owned resource disposed exactly once"); };
}

test("all PROGRAM_INFO attackers, canonical aliases and fallback finish and dispose", () => {
  const keys = Object.entries(PROGRAM_INFO).filter(([, info]) => info.group === "attacker").map(([key]) => key);
  assert.equal(keys.length, 8);
  for (const key of [...keys, "deckkrash", "poisonflatline", "unknownattacker", "custom attacker"]) {
    const world = new THREE.Group(), fx = createAttackEffects(world);
    assert.equal(fx.update(100), false); assert.equal(fx.play(event(key), 100), true);
    const disposed = watchResources(world);
    close(fx.inspect().effects[0].position, from);
    close(fx.inspect().effects[0].end, to);
    assert.equal(fx.update(579), true); assert.equal(fx.inspect().effects[0].phase, "flight");
    assert.equal(fx.update(580), true); close(fx.inspect().effects[0].position, to);
    world.updateMatrixWorld(true);
    const group = world.children[0], dots = group.getObjectByName("particles");
    close(dots.getWorldPosition(new THREE.Vector3()).toArray(), to);
    assert.equal(group.getObjectByName("projectile").visible, false);
    assert.equal(fx.inspect().effects[0].phase, "impact");
    assert.equal(fx.update(899), true); assert.equal(fx.update(900), false);
    assert.equal(world.children.length, 0); assert.equal(fx.inspect().active, 0);
    fx.clear(); disposed();
  }
});

test("direction-independent endpoints, including reversed Z and coincident points", () => {
  const destinations = [to, new THREE.Vector3(8, -20, 11), new THREE.Vector3(8, -3, -9), from.clone()];
  for (const destination of destinations) {
    const world = new THREE.Group(), fx = createAttackEffects(world);
    fx.play({ ...event("sword"), to: destination }, 0); fx.update(480); world.updateMatrixWorld(true);
    close(fx.inspect().effects[0].position, destination);
    close(world.children[0].getObjectByName("particles").getWorldPosition(new THREE.Vector3()).toArray(), destination);
    fx.clear();
  }
});

test("miss travels off-target and never creates a hit burst", () => {
  for (const key of ["sword", "banhammer", "hellbolt", "vrizzbolt", "deckkrash", "nervescrub", "poisonflatline", "superglue", "unknownattacker"]) {
    const world = new THREE.Group(), fx = createAttackEffects(world);
    fx.play(event(key, false), 0); const disposed = watchResources(world);
    const end = new THREE.Vector3(...fx.inspect().effects[0].end), offset = end.clone().sub(to);
    assert.ok(Math.abs(offset.length() - 1.1) < 1e-6);
    assert.ok(Math.abs(offset.dot(to.clone().sub(from))) < 1e-6, "miss offset is perpendicular to travel");
    for (const now of [0, 240, 480, 640, 799]) {
      assert.equal(fx.update(now), true); assert.equal(fx.inspect().effects[0].phase, "flight");
      const group = world.children[0], dots = group.getObjectByName("particles");
      const head = group.getObjectByName("projectile");
      assert.equal(head.visible, true); close(dots.position.toArray(), head.position);
      const positions = dots.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) assert.ok(positions.getZ(i) < 0, "particles trail the miss, never radiate from target");
    }
    close(fx.inspect().effects[0].position, end);
    assert.equal(fx.update(800), false); disposed();
  }
});

test("four-active cap rejects without allocation; expiry permits next play", () => {
  const world = new THREE.Group(), fx = createAttackEffects(world);
  for (let i = 0; i < 4; i++) assert.equal(fx.play(event(), 100), true);
  const children = [...world.children], disposed = watchResources(world);
  assert.equal(fx.play(event(), 100), false); assert.deepEqual(world.children, children);
  assert.equal(fx.inspect().active, 4); assert.equal(fx.play(event(), 900), true);
  disposed(); assert.equal(fx.inspect().active, 1); fx.clear();
});

test("clear is idempotent, preserves world and inputs, and supports reuse", () => {
  const world = new THREE.Group(), sourceModel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  world.add(sourceModel); sourceModel.position.copy(from);
  const fx = createAttackEffects(world), input = event("superglue"), original = from.clone();
  fx.play(input, 0); const disposed = watchResources(world.children[1]);
  input.from.set(100, 100, 100);
  close(fx.inspect().effects[0].from, original); close(sourceModel.position.toArray(), original);
  from.copy(original);
  const snapshot = fx.inspect(); snapshot.effects[0].from[0] = -999;
  close(fx.inspect().effects[0].from, original);
  fx.clear(); fx.clear(); disposed();
  assert.deepEqual(world.children, [sourceModel]); assert.equal(fx.update(0), false);
  assert.equal(fx.play(event(), 1000), true); fx.clear();
  sourceModel.geometry.dispose(); sourceModel.material.dispose();
});

test("explicit clocks, default performance clock, beam anchoring and color override", () => {
  const world = new THREE.Group(), fx = createAttackEffects(world);
  fx.play({ ...event("poisonflatline"), color: 0x123456 }, 0); fx.update(240);
  const group = world.children[0], head = group.getObjectByName("projectile"), beam = head.children[0];
  world.updateMatrixWorld(true);
  const start = new THREE.Vector3(0, -0.5, 0).applyMatrix4(beam.matrixWorld);
  const end = new THREE.Vector3(0, 0.5, 0).applyMatrix4(beam.matrixWorld);
  close(start.toArray(), from); close(end.toArray(), from.clone().lerp(to, 0.5));
  assert.equal(beam.material.color.getHex(), 0x123456);
  fx.clear();
  const clock = Object.getOwnPropertyDescriptor(globalThis, "performance");
  let now = 1500;
  try {
    Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
    assert.equal(fx.play(event()), true); now = 1700;
    assert.equal(fx.update(), true); assert.equal(fx.inspect().effects[0].elapsed, 200);
    now = 2300; assert.equal(fx.update(), false);
  } finally { Object.defineProperty(globalThis, "performance", clock); fx.clear(); }
});

test("orthographic particles use 3.5px screen size without attenuation", () => {
  for (const key of ["sword", "banhammer", "hellbolt", "vrizzbolt", "deckkrash", "nervescrub", "poisonflatline", "superglue", "unknownattacker"]) {
    const world = new THREE.Group(), fx = createAttackEffects(world);
    fx.play(event(key), 0);
    const material = world.getObjectByName("particles").material;
    assert.equal(material.size, 3.5); assert.equal(material.sizeAttenuation, false);
    assert.equal(material.depthTest, true); assert.equal(material.depthWrite, false);
    fx.clear();
  }
});

test("Nervescrub combines a shiny chrome sphere with sparks and cleans both", () => {
  const world = new THREE.Group(), fx = createAttackEffects(world);
  fx.play(event("nervescrub"), 0);
  const head = world.getObjectByName("projectile"), sphere = head.children.find(object => object.isMesh);
  assert.ok(sphere?.geometry instanceof THREE.SphereGeometry);
  assert.ok(sphere.material instanceof THREE.MeshPhongMaterial);
  assert.equal(sphere.material.color.getHex(), 0xc4cbd1);
  assert.equal(sphere.material.specular.getHex(), 0xffffff); assert.equal(sphere.material.shininess, 100);
  assert.ok(head.children.some(object => object.isLine)); assert.ok(world.getObjectByName("particles").isPoints);
  const disposed = watchResources(world);
  fx.update(700); assert.ok(sphere.material.opacity < 1);
  fx.clear(); disposed();
});

test("Sword sweeps a short slash around the impact, never around a miss", () => {
  for (const hit of [true, false]) {
    const world = new THREE.Group(), fx = createAttackEffects(world);
    fx.play(event("sword", hit), 0);
    const slash = world.getObjectByName("impact-slash"), disposed = watchResources(world);
    assert.ok(slash?.isMesh); assert.equal(slash.visible, false);
    fx.update(479); assert.equal(slash.visible, false);
    fx.update(480); assert.equal(slash.visible, hit);
    world.updateMatrixWorld(true); close(slash.getWorldPosition(new THREE.Vector3()).toArray(), to);
    const rotation = slash.rotation.z;
    fx.update(570); assert.equal(slash.visible, hit); assert.notEqual(slash.rotation.z, rotation);
    world.updateMatrixWorld(true); close(slash.getWorldPosition(new THREE.Vector3()).toArray(), to);
    fx.update(660); assert.equal(slash.visible, false);
    assert.equal(fx.update(800), false); disposed();
  }
});
