import { root, part, rod, ribbon } from "./model-kit.js";

export const STALKER_KEYS = ["scorpion", "skunk", "wisp", "dragon", "killer", "sabertooth"];

// Front: +Z (eyes, mouthparts and pincers).
function scorpion() {
  const group = root("scorpion"), shell = "#151923", joint = "#080b12", signal = "#9da9b8";
  part(group, "octa", [0, 0.36, -0.1], [0.95, 0.6, 1.3], shell);
  for (let i = 0; i < 3; i++) {
    part(group, "box", [0, 0.49 - i * 0.025, 0.15 - i * 0.25], [0.53 - i * 0.06, 0.16, 0.21], "#303846");
  }
  part(group, "box", [0, 0.34, 0.52], [0.54, 0.3, 0.4], joint);
  for (const side of [-1, 1]) {
    part(group, "octa", [side * 0.16, 0.47, 0.64], [0.19, 0.17, 0.2], shell);
    part(group, "octa", [side * 0.16, 0.49, 0.73], [0.12, 0.12, 0.1], signal);
    for (let i = 0; i < 4; i++) {
      const knee = [side * (0.6 + i * 0.05), 0.28, 0.46 - i * 0.36];
      rod(group, [side * 0.27, 0.31, 0.32 - i * 0.24], knee, 0.055, shell);
      rod(group, knee, [side * (0.78 + i * 0.05), 0.06, 0.55 - i * 0.42], 0.035, joint);
    }
    rod(group, [side * 0.23, 0.32, 0.5], [side * 0.65, 0.35, 0.92], 0.09, shell);
    part(group, "octa", [side * 0.7, 0.37, 1.04], [0.48, 0.32, 0.55], shell);
    part(group, "cone", [side * 0.84, 0.38, 1.3], [0.17, 0.52, 0.2], "#303846", [Math.PI / 2, 0, side * 0.35]);
    part(group, "cone", [side * 0.56, 0.38, 1.3], [0.17, 0.52, 0.2], "#303846", [Math.PI / 2, 0, -side * 0.35]);
    rod(group, [side * 0.84, 0.38, 1.48], [side * 0.75, 0.38, 1.56], 0.035, signal);
    rod(group, [side * 0.56, 0.38, 1.48], [side * 0.64, 0.38, 1.56], 0.035, signal);
    part(group, "cone", [side * 0.13, 0.31, 0.85], [0.11, 0.27, 0.11], "#535d6c", [Math.PI / 2, 0, side * 0.6]);
  }
  rod(group, [0, 0.35, -0.6], [0, 0.72, -1.02], 0.13, shell);
  rod(group, [0, 0.72, -1.02], [0, 1.24, -0.98], 0.11, shell);
  rod(group, [0, 1.24, -0.98], [0, 1.56, -0.56], 0.09, "#303846");
  rod(group, [0, 1.56, -0.56], [0, 1.45, -0.16], 0.075, shell);
  for (const position of [[0, 0.72, -1.02], [0, 1.24, -0.98], [0, 1.56, -0.56]]) {
    part(group, "octa", position, [0.27, 0.25, 0.25], "#303846");
  }
  part(group, "octa", [0, 1.43, -0.1], [0.26, 0.26, 0.3], signal);
  part(group, "cone", [0, 1.25, 0.04], [0.13, 0.4, 0.13], joint, [Math.PI - 0.55, 0, 0]);
  return group;
}

// Front: +Z (nose and paws); raised striped tail stays behind the body.
function skunk() {
  const group = root("skunk"), fur = "#202431", stripe = "#eef4ff", signal = "#e69caf";
  part(group, "sphere", [0, 0.87, 0.03], [0.86, 1.28, 0.76], fur);
  part(group, "sphere", [0, 0.83, 0.36], [0.48, 0.87, 0.22], stripe);
  part(group, "sphere", [0, 1.63, 0.22], [0.84, 0.77, 0.72], fur);
  part(group, "sphere", [0, 1.47, 0.58], [0.57, 0.33, 0.42], stripe);
  part(group, "octa", [0, 1.54, 0.8], [0.2, 0.17, 0.14], "#121927");
  part(group, "box", [0, 1.43, 0.78], [0.24, 0.035, 0.035], fur);
  rod(group, [0, 1.48, 0.79], [0, 1.43, 0.79], 0.018, fur);
  part(group, "box", [0, 1.82, 0.53], [0.16, 0.37, 0.11], stripe, [-0.35, 0, 0]);
  for (const side of [-1, 1]) {
    part(group, "sphere", [side * 0.34, 1.96, 0.18], [0.3, 0.34, 0.24], fur);
    part(group, "sphere", [side * 0.35, 1.96, 0.29], [0.15, 0.18, 0.06], signal);
    part(group, "sphere", [side * 0.22, 1.7, 0.55], [0.15, 0.19, 0.07], stripe);
    part(group, "sphere", [side * 0.21, 1.69, 0.59], [0.065, 0.1, 0.035], "#111725");
    part(group, "sphere", [side * 0.16, 1.48, 0.69], [0.24, 0.19, 0.19], stripe);
    rod(group, [side * 0.32, 1.1, 0.1], [side * 0.55, 0.64, 0.37], 0.12, fur);
    part(group, "sphere", [side * 0.55, 0.63, 0.4], [0.23, 0.22, 0.28], fur);
    part(group, "sphere", [side * 0.25, 0.2, 0.24], [0.33, 0.3, 0.58], fur);
    for (const offset of [-0.06, 0.06]) {
      part(group, "cone", [side * 0.55 + offset, 0.61, 0.55], [0.045, 0.14, 0.05], stripe, [Math.PI / 2, 0, 0]);
      part(group, "cone", [side * 0.25 + offset, 0.15, 0.55], [0.05, 0.13, 0.05], stripe, [Math.PI / 2, 0, 0]);
    }
  }
  // Thick overlapping lobes keep the raised tail volumetric, including its stripe.
  const tail = [[0, 0.77, -0.51], [0, 1.35, -0.88], [0, 1.97, -0.88], [0, 2.37, -0.56]];
  for (const position of tail) {
    part(group, "sphere", position, [0.99, 0.98, 0.68], fur);
    part(group, "sphere", position, [0.27, 0.99, 0.71], stripe);
  }
  return group;
}

// Front: +Z (single eye); electrical branches attach to the luminous body.
function wisp() {
  const group = root("wisp"), glow = "#cfffff", arc = "#409bff";
  part(group, "sphere", [0, 1.25, 0], [1.08, 1.12, 1.08], glow);
  part(group, "octa", [-0.2, 1.48, 0.35], [0.38, 0.42, 0.38], "#e3ffff");
  part(group, "torus", [0, 1.28, 0.51], [0.43, 0.47, 0.55], arc);
  part(group, "sphere", [0, 1.28, 0.54], [0.35, 0.39, 0.12], arc);
  part(group, "sphere", [0, 1.28, 0.595], [0.14, 0.25, 0.045], "#172e64");
  part(group, "sphere", [-0.045, 1.36, 0.615], [0.06, 0.065, 0.025], "#ffffff");
  rod(group, [-0.19, 1.69, -0.18], [-0.37, 2.03, -0.22], 0.022, arc);
  rod(group, [-0.37, 2.03, -0.22], [-0.1, 1.94, -0.3], 0.022, glow);
  rod(group, [-0.1, 1.94, -0.3], [0.04, 2.25, -0.17], 0.022, arc);
  for (const [tip, bend, start] of [
    [[-1.03, 1.62, 0.16], [-0.63, 1.85, 0.27], [-0.45, 1.49, 0.1]],
    [[0.95, 1.86, -0.16], [0.7, 1.44, -0.3], [0.44, 1.55, -0.12]],
    [[0.36, 0.35, 0.25], [0.02, 0.64, 0.49], [0.17, 0.86, 0.15]],
  ]) {
    part(group, "octa", tip, [0.1, 0.14, 0.1], "#e3ffff");
    rod(group, start, bend, 0.026, arc);
    rod(group, bend, tip, 0.026, glow);
  }
  rod(group, [-0.63, 1.85, 0.27], [-0.72, 2.03, 0.23], 0.018, glow);
  rod(group, [0.7, 1.44, -0.3], [0.91, 1.29, -0.24], 0.018, glow);
  rod(group, [0.02, 0.64, 0.49], [-0.19, 0.47, 0.45], 0.018, arc);
  rod(group, [-0.26, 1.05, -0.36], [-0.5, 0.85, -0.57], 0.025, arc);
  rod(group, [-0.5, 0.85, -0.57], [-0.31, 0.68, -0.62], 0.018, glow);
  return group;
}

// Front: +Z (open jaws and foreclaws); tail trails toward -Z.
function dragon() {
  const group = root("dragon"), gold = "#d7a335", dark = "#77501e", light = "#ffe38a";
  part(group, "octa", [0, 0.96, -0.15], [0.92, 1.19, 1.52], gold);
  part(group, "box", [0, 0.96, 0.38], [0.57, 0.64, 0.23], dark, [0.2, 0, 0]);
  rod(group, [0, 1.12, 0.28], [0, 1.72, 0.54], 0.24, gold);
  part(group, "box", [0, 1.83, 0.67], [0.62, 0.49, 0.69], gold);
  part(group, "box", [0, 1.78, 1.03], [0.46, 0.2, 0.52], light);
  part(group, "box", [0, 1.64, 1.06], [0.4, 0.12, 0.46], dark);
  part(group, "box", [0, 1.55, 1.03], [0.44, 0.1, 0.51], gold);
  for (const side of [-1, 1]) {
    part(group, "cone", [side * 0.24, 2.16, 0.43], [0.18, 0.58, 0.2], light, [-0.4, 0, -side * 0.3]);
    part(group, "box", [side * 0.27, 1.92, 1.015], [0.12, 0.1, 0.07], "#69ffe6");
    part(group, "octa", [side * 0.13, 1.85, 1.25], [0.075, 0.055, 0.075], dark);
    for (const z of [0.96, 1.18]) {
      part(group, "cone", [side * 0.17, 1.64, z], [0.085, 0.19, 0.09], light, [Math.PI, 0, 0]);
    }
    ribbon(group, [[side * 0.25, 1.13, -0.28], [side * 1.5, 2.08, -0.42], [side * 1.63, 1.24, -0.35], [side * 1.05, 1.4, -0.2], [side * 0.98, 0.83, -0.23], [side * 0.55, 1.05, -0.17]], gold);
    rod(group, [side * 0.25, 1.13, -0.28], [side * 1.5, 2.08, -0.42], 0.065, light);
    rod(group, [side * 1.5, 2.08, -0.42], [side * 1.63, 1.24, -0.35], 0.04, light);
    rod(group, [side * 1.5, 2.08, -0.42], [side * 0.98, 0.83, -0.23], 0.035, light);
    rod(group, [side * 0.3, 0.81, 0.28], [side * 0.52, 0.21, 0.61], 0.15, gold);
    part(group, "box", [side * 0.52, 0.13, 0.76], [0.31, 0.21, 0.49], dark);
    rod(group, [side * 0.33, 0.7, -0.62], [side * 0.6, 0.2, -0.76], 0.18, gold);
    part(group, "box", [side * 0.61, 0.12, -0.57], [0.35, 0.2, 0.49], dark);
    for (const offset of [-0.1, 0, 0.1]) {
      part(group, "cone", [side * 0.52 + offset, 0.13, 1.03], [0.075, 0.23, 0.075], light, [Math.PI / 2, 0, 0]);
    }
    rod(group, [side * 1.4, 2.08, -0.35], [side * 0.94, 1.83, 0.15], 0.035, "#c2faff");
    rod(group, [side * 0.94, 1.83, 0.15], [side * 1.13, 1.35, 0.35], 0.035, "#ffffff");
    rod(group, [side * 1.13, 1.35, 0.35], [side * 0.48, 1.02, 0.7], 0.035, "#c2faff");
  }
  rod(group, [0, 0.72, -0.65], [0.2, 0.51, -1.18], 0.18, gold);
  rod(group, [0.2, 0.51, -1.18], [0.64, 0.4, -1.48], 0.12, gold);
  rod(group, [0.64, 0.4, -1.48], [0.96, 0.57, -1.35], 0.075, light);
  for (let i = 0; i < 2; i++) {
    part(group, "box", [0, 0.83 + i * 0.17, 0.49 + i * 0.025], [0.4 - i * 0.04, 0.11, 0.1], light, [0.2, 0, 0]);
  }
  return group;
}

// Front: +Z (mask, breastplate and toes); sword stays in the right hand.
function killer() {
  const group = root("killer"), armor = "#b63148", steel = "#28374c", edge = "#c2ecff";
  part(group, "box", [0, 0.92, 0], [0.65, 0.35, 0.43], steel);
  part(group, "box", [0, 1.4, 0], [0.8, 0.69, 0.48], armor);
  part(group, "box", [0, 1.45, 0.26], [0.43, 0.3, 0.07], "#ed6471");
  part(group, "sphere", [0, 2, 0], [0.55, 0.56, 0.51], steel);
  part(group, "cone", [0, 2.21, -0.02], [0.94, 0.48, 0.78], armor);
  part(group, "box", [0, 1.97, 0.26], [0.42, 0.26, 0.07], "#121b2d");
  part(group, "box", [0, 1.91, 0.31], [0.065, 0.15, 0.08], armor);
  part(group, "box", [0, 1.82, 0.28], [0.3, 0.1, 0.13], steel);
  for (let i = 0; i < 3; i++) {
    part(group, "box", [0, 1.25 + i * 0.13, 0.285], [0.62, 0.045, 0.055], steel);
  }
  for (const side of [-1, 1]) {
    part(group, "box", [side * 0.11, 2.025, 0.31], [0.115, 0.065, 0.04], "#ff202e", [0, 0, -side * 0.13]);
    part(group, "box", [side * 0.23, 0.52, 0], [0.28, 0.69, 0.31], steel, [0, 0, -side * 0.1]);
    part(group, "box", [side * 0.29, 0.14, 0.13], [0.37, 0.24, 0.57], armor);
    part(group, "box", [side * 0.26, 0.49, 0.18], [0.23, 0.29, 0.09], armor, [0, 0, -side * 0.1]);
    part(group, "box", [side * 0.29, 0.86, 0.08], [0.28, 0.35, 0.47], armor, [0, 0, -side * 0.18]);
    part(group, "box", [side * 0.6, 1.63, 0], [0.46, 0.28, 0.58], armor, [0, 0, -side * 0.15]);
    rod(group, [side * 0.55, 1.48, 0], [side * 0.76, 1.13, 0.12], 0.1, steel);
    part(group, "box", [side * 0.77, 1.06, 0.2], [0.24, 0.39, 0.29], armor, [-0.3, 0, 0]);
    part(group, "sphere", [side * 0.78, 0.88, 0.25], [0.23, 0.23, 0.23], steel);
    part(group, "cone", [side * 0.26, 2.43, 0.16], [0.12, 0.55, 0.15], "#f2c65c", [0, 0, -side * 0.55]);
    part(group, "box", [side * 0.25, 1.92, 0.19], [0.14, 0.35, 0.24], armor, [0, 0, -side * 0.17]);
  }
  rod(group, [0.78, 0.71, 0.25], [0.78, 1.13, 0.25], 0.065, steel);
  part(group, "box", [0.78, 1.13, 0.25], [0.46, 0.07, 0.19], "#f2c65c");
  part(group, "sphere", [0.78, 0.7, 0.25], [0.17, 0.12, 0.17], "#f2c65c");
  for (let i = 0; i < 3; i++) {
    part(group, "box", [0.78, 0.8 + i * 0.08, 0.31], [0.105, 0.035, 0.035], edge, [0, 0, 0.4]);
  }
  part(group, "box", [0.79, 1.59, 0.25], [0.13, 0.88, 0.055], edge, [0, 0, -0.035]);
  part(group, "box", [0.84, 2.22, 0.25], [0.11, 0.42, 0.055], edge, [0, 0, -0.2]);
  part(group, "box", [0.8, 1.77, 0.285], [0.035, 1.21, 0.02], "#ffffff", [0, 0, -0.06]);
  part(group, "cone", [0.9, 2.48, 0.25], [0.11, 0.2, 0.055], "#ffffff", [0, 0, -0.3]);
  return group;
}

// Front: +Z (muzzle, saber teeth and claws).
function sabertooth() {
  const group = root("sabertooth"), fur = "#bd7937", dark = "#503b35", tooth = "#ffffff";
  part(group, "sphere", [0, 0.96, -0.12], [1.35, 1.23, 1.93], fur);
  part(group, "octa", [0, 1.2, 0.45], [1.72, 1.5, 1.19], "#e3a14e");
  part(group, "box", [0, 1.34, 0.94], [1.19, 0.81, 0.82], fur);
  part(group, "sphere", [0, 1.13, 1.33], [0.8, 0.42, 0.45], "#e8bd7e");
  part(group, "octa", [0, 1.25, 1.55], [0.31, 0.21, 0.17], dark);
  part(group, "box", [0, 0.99, 1.27], [0.6, 0.17, 0.38], dark);
  part(group, "sphere", [0, 0.87, 1.3], [0.61, 0.17, 0.44], "#e8bd7e");
  for (const side of [-1, 1]) {
    part(group, "cone", [side * 0.43, 1.81, 0.83], [0.34, 0.43, 0.3], dark, [0, 0, -side * 0.22]);
    part(group, "box", [side * 0.28, 1.49, 1.36], [0.19, 0.075, 0.055], "#80fff0", [0, 0, -side * 0.2]);
    part(group, "box", [side * 0.28, 1.55, 1.34], [0.28, 0.08, 0.12], dark, [0, 0, -side * 0.2]);
    part(group, "box", [side * 0.28, 1.49, 1.395], [0.035, 0.075, 0.025], dark);
    part(group, "sphere", [side * 0.2, 1.1, 1.48], [0.32, 0.24, 0.19], "#e8bd7e");
    part(group, "cone", [side * 0.33, 0.78, 1.48], [0.29, 1.13, 0.31], tooth, [Math.PI - 0.16, 0, -side * 0.1]);
    part(group, "box", [side * 0.52, 0.51, 0.57], [0.47, 0.87, 0.53], fur, [0.06, 0, -side * 0.06]);
    part(group, "box", [side * 0.56, 0.17, 0.76], [0.56, 0.25, 0.7], dark);
    part(group, "sphere", [side * 0.43, 0.5, -0.74], [0.48, 0.78, 0.59], fur);
    part(group, "box", [side * 0.48, 0.16, -0.58], [0.43, 0.25, 0.57], dark);
    for (const offset of [-0.16, 0, 0.16]) {
      part(group, "cone", [side * 0.56 + offset, 0.14, 1.13], [0.095, 0.27, 0.11], tooth, [Math.PI / 2, 0, 0]);
    }
    part(group, "cone", [side * 0.17, 0.97, 1.47], [0.1, 0.19, 0.1], tooth);
    part(group, "box", [side * 0.66, 1.06, -0.18], [0.09, 0.4, 0.17], dark, [0.35, 0, side * 0.2]);
    part(group, "box", [side * 0.62, 1.08, -0.57], [0.1, 0.35, 0.16], dark, [0.35, 0, side * 0.2]);
  }
  rod(group, [0, 0.91, -0.96], [0.48, 0.82, -1.36], 0.09, fur);
  rod(group, [0.48, 0.82, -1.36], [0.79, 1.06, -1.4], 0.065, dark);
  return group;
}

export function stalkerModel(key) {
  switch (key) {
    case "scorpion": return scorpion();
    case "skunk": return skunk();
    case "wisp": return wisp();
    case "dragon": return dragon();
    case "killer": return killer();
    case "sabertooth": return sabertooth();
    default: return null;
  }
}
