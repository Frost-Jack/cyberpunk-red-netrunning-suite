import { THREE, root, part, rod, ribbon } from "./model-kit.js";

export const HUNTER_KEYS = ["asp", "giant", "hellhound", "kraken", "liche", "raven"];

// Front: +Z.
function aspModel() {
  const group = root("asp");
  const gold = "#c69225", bright = "#ffe279", dark = "#65441d";
  const coil = [
    [0.3, 0.22, 0.5], [0.85, 0.22, 0.25], [0.9, 0.22, -0.4],
    [0.35, 0.22, -0.8], [-0.45, 0.22, -0.72], [-0.9, 0.22, -0.12],
    [-0.65, 0.26, 0.48], [-0.1, 0.35, 0.55], [0, 0.58, 0.04],
  ];
  for (let i = 1; i < coil.length; i++) {
    rod(group, coil[i - 1], coil[i], 0.19, i % 2 ? gold : dark);
    part(group, "sphere", coil[i], [0.38, 0.38, 0.38], gold);
  }
  part(group, "cone", [0.35, 0.22, 0.62], [0.26, 0.56, 0.26], dark, [Math.PI / 2, 0, -0.25]);
  rod(group, [0, 0.58, 0.04], [0, 1.32, -0.1], 0.22, gold);
  rod(group, [0, 1.32, -0.1], [0, 1.95, 0.13], 0.19, bright);
  for (const side of [-1, 1]) {
    part(group, "octa", [side * 0.34, 1.68, -0.11], [0.8, 1.25, 0.4], gold, [0, 0, side * 0.32]);
    part(group, "box", [side * 0.32, 1.66, 0.1], [0.12, 0.7, 0.07], dark, [0, 0, side * 0.32]);
    for (let i = 0; i < 3; i++) {
      rod(group, [side * 0.19, 1.43 + i * 0.18, 0.08], [side * (0.44 - i * 0.035), 1.49 + i * 0.18, 0.01], 0.025, bright);
    }
    part(group, "box", [side * 0.2, 2.16, 0.5], [0.19, 0.07, 0.15], dark, [0, 0, -side * 0.16]);
    part(group, "box", [side * 0.19, 2.1, 0.52], [0.1, 0.07, 0.08], "#ff5a16");
    part(group, "cone", [side * 0.16, 1.85, 0.47], [0.07, 0.28, 0.07], bright, [Math.PI, 0, 0]);
    part(group, "box", [side * 0.1, 2.02, 0.61], [0.06, 0.035, 0.035], dark);
  }
  part(group, "sphere", [0, 2.02, 0.24], [0.65, 0.46, 0.76], gold);
  part(group, "box", [0, 1.93, 0.4], [0.4, 0.1, 0.43], dark);
  part(group, "box", [0, 1.77, 0.35], [0.4, 0.09, 0.43], gold);
  for (let i = 0; i < 3; i++) part(group, "box", [0, 1.12 + i * 0.22, 0.11], [0.27, 0.1, 0.07], bright, [-0.2, 0, 0]);
  rod(group, [0, 1.93, 0.6], [0, 1.87, 1.54], 0.055, "#6dff00");
  part(group, "octa", [0, 1.87, 1.54], [0.14, 0.14, 0.25], "#a3ff24");
  return group;
}

// Front: +Z.
function giantModel() {
  const group = root("giant");
  for (const side of [-1, 1]) {
    const x = side * 0.61;
    part(group, "box", [x, 0.26, 0.22], [1.02, 0.5, 1.63], "#445678");
    part(group, "box", [x, 0.1, 0.23], [1.1, 0.2, 1.73], "#192238");
    part(group, "box", [x, 0.49, 0.64], [1.04, 0.32, 0.64], "#899cba", [-0.18, 0, 0]);
    part(group, "box", [x, 0.35, -0.55], [1.05, 0.5, 0.27], "#293b5a");
    part(group, "box", [x, 0.68, 0.12], [0.85, 0.24, 0.42], "#a7bdd3", [-0.3, 0, 0]);
    for (const offset of [-0.26, 0, 0.26]) {
      part(group, "box", [x + offset, 0.47, 0.98], [0.035, 0.23, 0.14], "#293b5a", [-0.18, 0, 0]);
    }
    for (const z of [-0.24, 0.55]) part(group, "box", [x, 0.1, z], [1.15, 0.13, 0.15], "#445678");
    part(group, "cylinder", [x, 0.75, -0.2], [0.78, 0.63, 0.78], "#1c293e");
    part(group, "box", [x, 1.42, -0.22], [0.76, 1.2, 0.81], "#687f9e", [-0.09, 0, side * 0.05]);
    part(group, "box", [x, 1.45, 0.22], [0.55, 0.92, 0.18], "#a7bdd3", [-0.09, 0, 0]);
    part(group, "box", [x, 1.96, -0.22], [0.9, 0.27, 0.94], "#293b5a");
    rod(group, [x + side * 0.43, 0.65, -0.27], [x + side * 0.43, 1.79, -0.3], 0.095, "#c0d0de");
    part(group, "cylinder", [x + side * 0.39, 0.77, -0.2], [0.4, 0.17, 0.4], "#899cba", [0, 0, Math.PI / 2]);
    for (const y of [1.12, 1.78]) part(group, "box", [x, y, 0.33], [0.65, 0.09, 0.12], "#445678");
    part(group, "box", [x, 1.4, 0.32], [0.13, 0.62, 0.045], "#79e5ff");
    part(group, "box", [x, 0.39, 1.05], [0.68, 0.09, 0.05], "#79e5ff");
  }
  return group;
}

// Front: +Z.
function hellhoundModel() {
  const group = root("hellhound");
  part(group, "box", [0, 1.03, -0.11], [0.7, 0.64, 1.32], "#101216", [-0.08, 0, 0]);
  part(group, "octa", [0, 1.16, 0.44], [1.02, 1.02, 0.86], "#30353b");
  part(group, "box", [0, 1.59, 0.75], [0.64, 0.55, 0.67], "#25282d", [-0.16, 0, 0]);
  part(group, "box", [0, 1.48, 1.12], [0.48, 0.28, 0.49], "#101216");
  part(group, "box", [0, 1.17, 1.05], [0.4, 0.05, 0.53], "#ff843a", [0.12, 0, 0]);
  part(group, "box", [0, 1.1, 1.1], [0.46, 0.13, 0.56], "#25282d", [0.12, 0, 0]);
  part(group, "box", [0, 1.53, 1.38], [0.3, 0.16, 0.13], "#30353b");
  for (const side of [-1, 1]) {
    for (const z of [-0.58, 0.42]) {
      const knee = [side * 0.43, 0.54, z - 0.16];
      rod(group, [side * 0.28, 1.03, z], knee, 0.15, "#30353b");
      rod(group, knee, [side * 0.46, 0.12, z + 0.06], 0.12, "#171a20");
      part(group, "box", [side * 0.46, 0.1, z + 0.13], [0.3, 0.2, 0.4], "#24282e");
      for (const toe of [-0.07, 0.07]) part(group, "cone", [side * 0.46 + toe, 0.07, z + 0.34], [0.07, 0.22, 0.07], "#8995a3", [Math.PI / 2, 0, 0]);
    }
    part(group, "cone", [side * 0.25, 2, 0.63], [0.25, 0.55, 0.25], "#202329", [0.12, 0, -side * 0.22]);
    part(group, "cone", [side * 0.25, 2.01, 0.71], [0.12, 0.32, 0.035], "#59616c", [0.12, 0, -side * 0.22]);
    part(group, "box", [side * 0.21, 1.7, 1.06], [0.14, 0.09, 0.08], "#ffffff");
    part(group, "box", [side * 0.22, 1.77, 1.03], [0.24, 0.09, 0.16], "#30353b", [0, 0, -side * 0.17]);
    for (const z of [1.08, 1.38]) part(group, "cone", [side * 0.215, 1.32, z], [0.1, 0.24, 0.1], "#c0c8d0", [Math.PI, 0, 0]);
    part(group, "sphere", [side * 0.22, 1.27, 0.86], [0.18, 0.25, 0.22], "#30353b");
    part(group, "octa", [side * 0.38, 1.22, 0.35], [0.32, 0.7, 0.65], "#202329", [-0.15, 0, -side * 0.18]);
    part(group, "octa", [side * 0.37, 1.11, -0.16], [0.25, 0.78, 1.09], "#ff682d", [-0.22, 0, -side * 0.18]);
  }
  for (let i = 0; i < 3; i++) {
    part(group, "cone", [0, 1.56 - i * 0.08, 0.17 - i * 0.39], [0.23, 0.56 - i * 0.06, 0.24], i % 2 ? "#ffd15a" : "#ff682d", [-0.35, 0, 0]);
  }
  rod(group, [0, 1.04, -0.73], [0, 1.47, -1.2], 0.1, "#ff682d");
  return group;
}

// Front: +Z, tentacles reach out from the rear wall.
function krakenModel() {
  const group = root("kraken");
  part(group, "box", [-0.55, 0.92, -0.78], [1.08, 1.84, 0.16], "#682918", [0, -0.12, 0]);
  part(group, "box", [0.55, 0.92, -0.78], [1.08, 1.84, 0.16], "#682918", [0, 0.12, 0]);
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
    const points = [
      [side * 0.55, 0.35 + row * 0.56, -0.68],
      [side * (1.04 + row * 0.12), 0.25 + row * 0.6, -0.12],
      [side * (0.9 - row * 0.14), 0.28 + row * 0.57 + side * 0.16, 0.78 + (row % 2) * 0.19],
      [side * (0.46 - row * 0.1), 0.6 + row * 0.59 + side * (row === 1 ? -0.25 : 0.18), 1.02 + (row === 1 ? side * 0.12 : 0)],
    ];
    for (let j = 1; j < points.length; j++) {
      const radius = [0, 0.18, 0.13, 0.075][j];
      const start = new THREE.Vector3(...points[j - 1]), end = new THREE.Vector3(...points[j]);
      const direction = end.clone().sub(start).normalize();
      if (j === 3) {
        const tip = part(group, "cone", start.clone().lerp(end, 0.5).toArray(), [0.26, start.distanceTo(end), 0.26], "#ffae45");
        tip.quaternion.setFromUnitVectors(group.up, direction);
      } else rod(group, points[j - 1], points[j], radius, i % 2 ? "#f77d20" : "#c55312");
      if (j === 1) part(group, "sphere", points[j], [radius * 2, radius * 2, radius * 2], "#f77d20");
      const normal = group.up.clone().addScaledVector(direction, -direction.y).normalize();
      const cup = start.lerp(end, 0.5).addScaledVector(normal, radius * 0.9);
      const ring = part(group, "torus", cup.toArray(), [radius * 1.65, radius * 1.65, 1.1], "#e51f30");
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      if (j === 2) {
        const goop = part(group, "sphere", cup.clone().addScaledVector(normal, -0.015).toArray(), [0.2, 0.065, 0.24], "#e51f30");
        goop.quaternion.setFromUnitVectors(group.up, normal);
      }
    }
  }
  return group;
}

// Front: +Z.
function licheModel() {
  const group = root("liche");
  part(group, "cone", [0, 0.81, -0.06], [1.2, 1.62, 0.96], "#101116");
  part(group, "box", [0, 1.62, -0.05], [1.14, 0.24, 0.5], "#24252b");
  rod(group, [0, 0.65, 0.28], [0, 1.69, 0.28], 0.07, "#aab9c5");
  for (let i = 0; i < 3; i++) part(group, "box", [0, 1.43 - i * 0.22, 0.3], [0.68 - i * 0.12, 0.09, 0.2], "#aab9c5");
  part(group, "cone", [0, 2.01, -0.12], [0.96, 1.17, 0.8], "#15161c");
  part(group, "sphere", [0, 2.03, 0.22], [0.61, 0.67, 0.53], "#c7d2db");
  part(group, "box", [0, 1.78, 0.3], [0.36, 0.18, 0.36], "#8495a3");
  part(group, "cone", [0, 1.96, 0.52], [0.1, 0.17, 0.08], "#14151a", [Math.PI, 0, 0]);
  for (const x of [-0.12, -0.04, 0.04, 0.12]) part(group, "box", [x, 1.79, 0.49], [0.045, 0.12, 0.05], "#d0dce5");
  for (const x of [-0.34, 0, 0.34]) ribbon(group, [[x * 0.25, 1.45, 0.03], [x - 0.07, 0.08, 0.42], [x + 0.07, 0.08, 0.42]], "#24252b");
  for (const side of [-1, 1]) {
    part(group, "box", [side * 0.22, 1.88, 0.36], [0.18, 0.16, 0.24], "#8495a3", [0, 0, side * 0.25]);
    part(group, "box", [side * 0.15, 2.08, 0.44], [0.22, 0.16, 0.1], "#23142f");
    part(group, "box", [side * 0.15, 2.08, 0.5], [0.11, 0.07, 0.035], "#ed80ff");
    part(group, "box", [side * 0.94, 1.15, 0.28], [0.28, 0.34, 0.17], "#aab9c5", [0, 0, side * 0.24]);
    rod(group, [side * 0.47, 1.61, 0], [side * 0.76, 1.34, 0.16], 0.17, "#15161c");
    rod(group, [side * 0.76, 1.34, 0.16], [side * 0.94, 1.15, 0.28], 0.065, "#aab9c5");
    rod(group, [side * 1.03, 1.16, 0.33], [side * 1.13, 0.86, 0.46], 0.045, "#d0dce5");
    rod(group, [side * 0.9, 1.12, 0.36], [side * 0.9, 0.84, 0.53], 0.045, "#d0dce5");
    rod(group, [side * 0.82, 1.21, 0.32], [side * 0.72, 1.02, 0.47], 0.04, "#d0dce5");
    for (const x of [0.92, 1.06]) {
      part(group, "torus", [side * x, 1.06, 0.4], [0.16, 0.16, 1.4], "#08090d", [1.03, 0, 0]);
      part(group, "octa", [side * x, 1.09, 0.46], [0.12, 0.12, 0.1], "#23142f");
    }
    const arc = [[side * 0.92, 1.09, 0.48], [side * 0.96, 1.22, 0.52], [side * 1.06, 1.09, 0.48]];
    for (let i = 1; i < arc.length; i++) rod(group, arc[i - 1], arc[i], 0.025, "#c3b4ff");
  }
  return group;
}

// Front: +Z; beak, talons and lance point forward, feathers trail toward -Z.
function ravenModel() {
  const group = root("raven");
  part(group, "octa", [0, 1.01, 0], [0.65, 1.05, 1.03], "#243449", [0.32, 0, 0]);
  part(group, "sphere", [0, 1.64, 0.38], [0.6, 0.6, 0.68], "#475775");
  part(group, "cone", [0, 1.59, 0.75], [0.23, 0.38, 0.25], "#9cabc1", [Math.PI / 2, 0, 0]);
  part(group, "box", [0, 1.58, 0.77], [0.12, 0.025, 0.26], "#243449");
  part(group, "octa", [0, 1.09, 0.26], [0.59, 0.73, 0.47], "#9cabc1", [0.28, 0, 0]);
  part(group, "torus", [0, 1.42, 0.24], [0.55, 0.55, 1.1], "#596582", [Math.PI / 2, 0, 0]);
  for (const side of [-1, 1]) {
    part(group, "box", [side * 0.25, 1.72, 0.57], [0.06, 0.07, 0.15], "#c389ff");
    part(group, "box", [side * 0.21, 1.78, 0.5], [0.18, 0.08, 0.22], "#9cabc1", [0, 0, -side * 0.18]);
    part(group, "octa", [side * 0.66, 1.28, -0.04], [1.22, 0.39, 0.85], "#596582", [0, side * 0.22, side * 0.19]);
    part(group, "octa", [side * 1.3, 1.35, -0.21], [0.98, 0.23, 0.7], "#34415d", [0, -side * 0.35, -side * 0.1]);
    for (let i = 0; i < 2; i++) part(group, "box", [side * (0.57 + i * 0.35), 1.44, -0.04 - i * 0.06], [0.41, 0.07, 0.45], i ? "#596582" : "#9cabc1", [0, side * 0.22, side * 0.1]);
    for (let i = 0; i < 3; i++) {
      part(group, "cone", [side * (0.69 + i * 0.36), 1.21, -0.55 - i * 0.06], [0.28, 0.96 - i * 0.1, 0.18], i === 1 ? "#7c6eac" : "#303b52", [-Math.PI / 2, 0, side * 0.14]);
    }
    rod(group, [side * 0.16, 0.81, 0.12], [side * 0.22, 0.28, 0.23], 0.055, "#9babc0");
    part(group, "box", [side * 0.22, 0.21, 0.4], [0.18, 0.1, 0.4], "#c5c7e4");
    part(group, "cylinder", [side * 0.22, 0.38, 0.21], [0.16, 0.18, 0.16], "#596582");
    for (const toe of [-0.06, 0.06]) {
      rod(group, [side * 0.22 + toe, 0.28, 0.3], [side * 0.22 + toe, 0.3, 0.55], 0.025, "#c5c7e4");
      part(group, "cone", [side * 0.22 + toe, 0.23, 0.56], [0.055, 0.18, 0.055], "#9cabc1", [Math.PI - 0.3, 0, 0]);
    }
    part(group, "cone", [side * 0.22, 0.19, 0.14], [0.07, 0.24, 0.07], "#9cabc1", [-Math.PI / 2, 0, 0]);
    part(group, "cone", [side * 0.14, 0.82, -0.68], [0.26, 0.88, 0.14], "#475775", [-Math.PI / 2 - 0.25, 0, -side * 0.12]);
  }
  rod(group, [0.22, 0.23, -0.48], [0.22, 0.23, 1.45], 0.045, "#f4faff");
  part(group, "cone", [0.22, 0.23, 1.7], [0.22, 0.5, 0.22], "#ffffff", [Math.PI / 2, 0, 0]);
  part(group, "cylinder", [0.22, 0.23, 0.42], [0.13, 0.36, 0.13], "#34415d", [Math.PI / 2, 0, 0]);
  part(group, "octa", [0.22, 0.23, -0.49], [0.16, 0.16, 0.2], "#9cabc1");
  part(group, "torus", [0.22, 0.23, 0.69], [0.27, 0.27, 0.7], "#9cabc1");
  return group;
}

export function hunterModel(key) {
  switch (key) {
    case "asp": return aspModel();
    case "giant": return giantModel();
    case "hellhound": return hellhoundModel();
    case "kraken": return krakenModel();
    case "liche": return licheModel();
    case "raven": return ravenModel();
    default: return null;
  }
}
