import { THREE } from "./model-kit.js";

const DURATION = 800, FLIGHT = 480, PARTICLES = 24, MAX_ACTIVE = 4;
const colors = { sword: 0xc9f5ff, banhammer: 0xffc36a, hellbolt: 0xff742f, vrizzbolt: 0x9bafff,
  deckkrash: 0xffaa44, nervescrub: 0xffee93, poisonflatline: 0x69ff69, superglue: 0xf04455 };
const clamp = n => Math.max(0, Math.min(1, n));
const forward = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);

/** Endpoints are in world's local coordinates; clocks are monotonic milliseconds.
 * No frame scheduling: the caller renders while update(now) returns true. */
export function createAttackEffects(world) {
  const active = [];

  function dispose(fx) {
    fx.group.removeFromParent();
    const geometries = new Set(), materials = new Set();
    fx.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    fx.group.clear();
  }

  function animate(fx, now) {
    const elapsed = Math.max(0, now - fx.start), impact = fx.hit && elapsed >= FLIGHT;
    const travel = clamp(elapsed / (fx.hit ? FLIGHT : 640));
    const fade = impact ? 1 - clamp((elapsed - FLIGHT) / (DURATION - FLIGHT)) : 1 - clamp((elapsed - 640) / 160);
    fx.elapsed = elapsed; fx.impact = impact;
    const arc = !fx.beam && travel > 0 && travel < 1 ? Math.sin(Math.PI * travel) * 1.2 : 0;
    fx.head.position.set(fx.miss * travel * travel, arc, fx.distance * travel);
    fx.head.visible = !impact;
    if (fx.slash) {
      fx.slash.visible = impact && elapsed < FLIGHT + 180;
      fx.slash.position.copy(fx.impactPoint);
      fx.slash.rotation.z = -1.2 + clamp((elapsed - FLIGHT) / 180) * 2.4;
    }
    if (fx.key === "sword") fx.head.rotation.z = -0.9 + travel * 1.8;
    if (fx.key === "banhammer") fx.head.rotation.x = -1.1 + travel * 1.5;
    if (["vrizzbolt", "nervescrub", "deckkrash"].includes(fx.key)) fx.head.rotation.z = elapsed * 0.014;
    if (fx.key === "superglue") fx.head.scale.setScalar(1 + 0.12 * Math.sin(elapsed * 0.025));
    if (fx.beam) {
      const length = fx.head.position.length();
      fx.beam.position.copy(fx.head.position).multiplyScalar(-0.5);
      fx.beam.scale.y = Math.max(0.001, length);
      fx.beam.quaternion.setFromUnitVectors(up, length ? fx.head.position.clone().normalize() : forward);
    }
    fx.dots.position.copy(impact ? fx.impactPoint : fx.head.position);
    const positions = fx.dots.geometry.getAttribute("position");
    for (let i = 0; i < PARTICLES; i++) {
      const direction = fx.directions[i];
      const radius = impact ? 0.05 + (elapsed - FLIGHT) * 0.006 : 0.15;
      positions.setXYZ(i, direction.x * radius, direction.y * radius,
        impact ? direction.z * radius : -0.12 - (i % 6) * 0.15);
    }
    positions.needsUpdate = true;
    for (const material of fx.materials) material.opacity = fade;
  }

  function update(now = performance.now()) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (now - active[i].start >= DURATION) { dispose(active[i]); active.splice(i, 1); }
      else animate(active[i], now);
    }
    return active.length > 0;
  }

  function play({ key, from, to, hit, color }, now = performance.now()) {
    if (!from?.isVector3 || !to?.isVector3 || ![...from, ...to, now].every(Number.isFinite)) return false;
    update(now);
    if (active.length >= MAX_ACTIVE) return false;
    key = String(key || "unknownattacker").toLowerCase().replace(/\s+/g, "");
    if (!Object.hasOwn(colors, key)) key = "unknownattacker";
    const direction = to.clone().sub(from), distance = direction.length();
    direction.copy(distance ? direction.normalize() : forward);
    const group = new THREE.Group(), head = new THREE.Group();
    group.name = `attack:${key}`; head.name = "projectile";
    group.position.copy(from); group.quaternion.setFromUnitVectors(forward, direction); group.add(head);
    const settings = { color: color ?? colors[key] ?? 0x80eaff, transparent: true, depthTest: true, depthWrite: false };
    const materials = [];
    let solid;
    const mesh = (geometry, position = [0, 0, 0], scale = [1, 1, 1]) => {
      if (!solid) { solid = new THREE.MeshBasicMaterial({ ...settings, side: THREE.DoubleSide }); materials.push(solid); }
      const object = new THREE.Mesh(geometry, solid);
      object.position.fromArray(position); object.scale.fromArray(scale); head.add(object); return object;
    };
    const line = points => {
      const material = new THREE.LineBasicMaterial(settings); materials.push(material);
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
      head.add(new THREE.Line(geometry, material));
    };
    let beam, slash;
    switch (key) {
      case "sword":
        mesh(new THREE.RingGeometry(0.65, 0.95, 16, 1, -0.9, 1.8));
        slash = head.children[0].clone(); slash.name = "impact-slash"; group.add(slash);
        break;
      case "banhammer":
        mesh(new THREE.BoxGeometry(0.95, 0.5, 0.5), [0, 0.4, 0]);
        mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 6), [0, -0.2, 0]);
        break;
      case "hellbolt":
        mesh(new THREE.SphereGeometry(0.32, 8, 6));
        mesh(new THREE.ConeGeometry(0.24, 0.85, 8), [0, 0, -0.5]).rotation.x = -Math.PI / 2;
        break;
      case "vrizzbolt":
        for (let strand = 0; strand < 2; strand++) line(Array.from({ length: 25 }, (_, i) => {
          const angle = i * 0.52 + strand * Math.PI;
          return [Math.cos(angle) * 0.28, Math.sin(angle) * 0.28, -i * 0.06];
        }));
        break;
      case "deckkrash":
        for (const x of [-0.25, 0, 0.25]) mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.75, 6), [x, 0, 0]).rotation.x = Math.PI / 2;
        line([[0, 0, 0.38], [0.12, 0, 0.55], [-0.1, 0, 0.7], [0.1, 0, 0.85]]);
        break;
      case "nervescrub": {
        const chrome = new THREE.MeshPhongMaterial({ ...settings, color: 0xc4cbd1, specular: 0xffffff, shininess: 100 });
        materials.push(chrome); head.add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), chrome));
        line([[-0.5, 0.1, -0.7], [0.3, -0.2, -0.45], [-0.25, 0.3, -0.2], [0.1, 0, 0.1], [0.4, -0.3, 0.2]]);
        break;
      }
      case "poisonflatline":
        beam = mesh(new THREE.CylinderGeometry(0.065, 0.065, 1, 6));
        break;
      case "superglue": {
        const geometry = new THREE.SphereGeometry(0.38, 8, 6);
        mesh(geometry, [0, 0, 0], [1, 0.85, 1.3]);
        mesh(geometry, [0.25, 0.1, -0.2], [0.65, 0.65, 0.65]);
        mesh(geometry, [-0.2, -0.15, -0.3], [0.5, 0.5, 0.5]);
        break;
      }
      default:
        mesh(new THREE.OctahedronGeometry(0.36));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    geometry.getAttribute("position").setUsage(THREE.DynamicDrawUsage);
    const particleMaterial = new THREE.PointsMaterial({ ...settings, size: 3.5, sizeAttenuation: false });
    const dots = new THREE.Points(geometry, particleMaterial); dots.name = "particles"; dots.frustumCulled = false;
    materials.push(particleMaterial); group.add(dots);
    const directions = Array.from({ length: PARTICLES }, (_, i) => {
      const z = 1 - 2 * (i + 0.5) / PARTICLES, radius = Math.sqrt(1 - z * z), angle = i * 2.399963;
      return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
    });
    const fx = { key, group, head, dots, beam, slash, materials, directions, distance, hit: hit === true,
      from: from.clone(), to: to.clone(), start: now, miss: hit === true ? 0 : 1.1, impactPoint: new THREE.Vector3(0, 0, distance) };
    active.push(fx); world.add(group); animate(fx, now); return true;
  }

  function clear() { for (const fx of active) dispose(fx); active.length = 0; }

  // Snapshots only: callers cannot mutate live endpoints or resources through inspect().
  function inspect() {
    return { active: active.length, maxActive: MAX_ACTIVE, effects: active.map(fx => ({
      key: fx.key, hit: fx.hit, elapsed: fx.elapsed, duration: DURATION, particles: PARTICLES,
      phase: fx.impact ? "impact" : "flight", from: fx.from.toArray(), to: fx.to.toArray(),
      position: fx.head.position.clone().applyQuaternion(fx.group.quaternion).add(fx.from).toArray(),
      end: new THREE.Vector3(fx.miss, 0, fx.distance).applyQuaternion(fx.group.quaternion).add(fx.from).toArray(),
    })) };
  }

  return { play, update, clear, inspect };
}
