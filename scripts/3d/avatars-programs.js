import { root, part, rod } from "./model-kit.js";

export const AVATAR_KEYS = ["runner", "imp", "efreet", "balron", "rocklobster"];
export const PROGRAM_KEYS = ["eraser", "seeya", "speedygonzalvez", "worm", "armor", "flak", "shield", "banhammer", "sword", "deckkrash", "hellbolt", "nervescrub", "poisonflatline", "superglue", "vrizzbolt"];

function humanoid(group, coat, metal, skin = metal) {
  part(group, "box", [0, 1.45, 0], [0.78, 0.9, 0.45], coat);
  part(group, "box", [0, 0.94, 0], [0.62, 0.25, 0.4], metal);
  part(group, "sphere", [0, 2.18, 0], [0.57, 0.68, 0.55], skin);
  for (const side of [-1, 1]) {
    rod(group, [side * 0.23, 0.92, 0], [side * 0.36, 0.22, 0.09], 0.14, coat);
    part(group, "box", [side * 0.36, 0.12, 0.17], [0.32, 0.23, 0.51], metal);
    rod(group, [side * 0.45, 1.78, 0], [side * 0.66, 1.06, 0.15], 0.12, coat);
  }
}

export function avatarModel(key) {
  if (!AVATAR_KEYS.includes(key)) return null;
  // All avatars face +Z; facial features and the toes project forward.
  const group = root(key);
  switch (key) {
    case "runner":
      humanoid(group, "#193b59", "#51d9ec");
      part(group, "box", [0, 2.22, 0.25], [0.49, 0.12, 0.09], "#d0ffff");
      part(group, "octa", [0, 1.5, 0.28], [0.35, 0.55, 0.17], "#b2ffff");
      part(group, "box", [0, 1.6, -0.33], [0.54, 0.68, 0.28], "#0c203b");
      part(group, "box", [0, 2.04, 0.23], [0.27, 0.15, 0.12], "#193b59");
      part(group, "box", [0, 2.02, 0.3], [0.19, 0.035, 0.035], "#51d9ec");
      part(group, "cylinder", [0, 1.93, 0], [0.26, 0.18, 0.26], "#0c203b");
      part(group, "box", [0, 1, 0.23], [0.25, 0.17, 0.08], "#b2ffff");
      for (const side of [-1, 1]) {
        part(group, "box", [side * 0.46, 1.82, 0], [0.27, 0.25, 0.5], "#36a7c5");
        part(group, "box", [side * 0.66, 1.08, 0.26], [0.17, 0.28, 0.1], "#b2ffff");
        part(group, "sphere", [side * 0.56, 1.43, 0.07], [0.25, 0.25, 0.25], "#0c203b");
        part(group, "box", [side * 0.67, 0.91, 0.19], [0.22, 0.23, 0.24], "#193b59");
        part(group, "octa", [side * 0.3, 0.57, 0.13], [0.32, 0.29, 0.2], "#36a7c5");
        part(group, "box", [side * 0.36, 0.16, 0.36], [0.3, 0.14, 0.21], "#193b59");
        rod(group, [side * 0.19, 1.9, -0.35], [side * 0.19, 1.28, -0.35], 0.035, "#51d9ec");
      }
      break;
    case "imp":
      part(group, "sphere", [0, 0.75, 0], [1.12, 1.08, 1.08], "#fa821c");
      part(group, "box", [0, 0.57, 0.48], [0.4, 0.09, 0.08], "#a92e15");
      part(group, "sphere", [0, 0.45, 0.43], [0.44, 0.24, 0.25], "#df6019");
      part(group, "octa", [0, 0.75, 0.58], [0.19, 0.23, 0.2], "#d92030");
      for (const side of [-1, 1]) {
        part(group, "cone", [side * 0.38, 1.36, 0], [0.28, 0.59, 0.28], "#d92030", [0, 0, -side * 0.35]);
        part(group, "box", [side * 0.21, 0.87, 0.49], [0.23, 0.12, 0.08], "#fff3b1", [0, 0, side * 0.18]);
        part(group, "cone", [side * 0.14, 0.51, 0.51], [0.1, 0.15, 0.1], "#fff1d3", [0, 0, Math.PI]);
        part(group, "box", [side * 0.21, 0.96, 0.47], [0.3, 0.09, 0.1], "#a92e15", [0, 0, side * 0.22]);
        part(group, "box", [side * 0.21, 0.86, 0.54], [0.045, 0.1, 0.035], "#a92e15");
        part(group, "octa", [side * 0.4, 0.66, 0.36], [0.28, 0.28, 0.29], "#fa821c");
        part(group, "sphere", [side * 0.51, 0.87, 0.02], [0.23, 0.37, 0.25], "#df6019");
      }
      break;
    case "efreet":
      humanoid(group, "#11131d", "#252a37", "#603c2d");
      part(group, "cylinder", [0, 2.6, 0], [0.58, 0.39, 0.54], "#d13c42");
      part(group, "cylinder", [0, 2.81, 0], [0.48, 0.04, 0.46], "#9e2433");
      rod(group, [0.08, 2.82, 0], [0.39, 2.61, 0.1], 0.035, "#201f32");
      part(group, "box", [0, 2.16, 0.29], [0.12, 0.15, 0.09], "#855640");
      part(group, "box", [0, 1.65, 0.26], [0.25, 0.55, 0.07], "#f7f1e8");
      part(group, "box", [0, 2.04, 0.22], [0.32, 0.17, 0.16], "#603c2d");
      part(group, "box", [0, 2.1, 0.31], [0.19, 0.035, 0.035], "#252a37");
      part(group, "cylinder", [0, 1.94, 0], [0.24, 0.18, 0.24], "#603c2d");
      part(group, "box", [0, 2.46, 0.27], [0.48, 0.065, 0.07], "#9e2433");
      for (const side of [-1, 1]) {
        part(group, "box", [side * 0.14, 2.27, 0.23], [0.1, 0.045, 0.055], "#eee4d4");
        part(group, "octa", [side * 0.075, 1.86, 0.32], [0.17, 0.13, 0.09], "#171c28");
        part(group, "box", [side * 0.2, 1.58, 0.27], [0.15, 0.65, 0.07], "#414554", [0, 0, side * 0.24]);
        part(group, "box", [side * 0.43, 1.81, 0], [0.31, 0.23, 0.53], "#1d202c");
        part(group, "cylinder", [side * 0.65, 1.1, 0.15], [0.25, 0.14, 0.25], "#edeae1");
        part(group, "box", [side * 0.66, 0.98, 0.17], [0.22, 0.22, 0.24], "#603c2d");
        part(group, "box", [side * 0.14, 2.33, 0.22], [0.16, 0.05, 0.06], "#252a37", [0, 0, side * 0.13]);
        part(group, "sphere", [side * 0.27, 2.17, 0], [0.15, 0.22, 0.17], "#603c2d");
        part(group, "sphere", [side * 0.56, 1.4, 0.08], [0.24, 0.24, 0.24], "#252a37");
        part(group, "box", [side * 0.36, 0.19, 0.28], [0.29, 0.19, 0.31], "#11131d");
      }
      rod(group, [0.66, 1.12, 0.2], [0.87, 1.42, 0.26], 0.065, "#332432");
      part(group, "box", [0.91, 1.43, 0.26], [0.43, 0.07, 0.16], "#e9ba62", [0, 0, -0.55]);
      part(group, "cone", [1.1, 1.77, 0.27], [0.23, 0.8, 0.1], "#dcf5f3", [0, 0, -0.5]);
      part(group, "sphere", [0.64, 1.08, 0.19], [0.17, 0.17, 0.18], "#e9ba62");
      rod(group, [0.72, 1.21, 0.26], [0.82, 1.35, 0.29], 0.025, "#e9ba62");
      break;
    case "balron":
    case "rocklobster":
      humanoid(group, "#10151c", "#252e38");
      part(group, "octa", [0, 1.57, 0.16], [1.52, 1.14, 1.02], "#171e27");
      part(group, "cylinder", [0, 1.96, 0], [0.35, 0.21, 0.35], "#303a46");
      part(group, "box", [0, 2.04, 0.27], [0.44, 0.18, 0.19], "#303a46");
      part(group, "box", [0, 2.07, 0.38], [0.29, 0.055, 0.05], "#10151c");
      for (const side of [-1, 1]) {
        part(group, "octa", [side * 0.66, 1.92, 0], [0.85, 0.65, 0.86], "#303a46");
        part(group, "box", [side * 0.68, 1.96, 0.37], [0.42, 0.07, 0.08], "#6eff48");
        part(group, "box", [side * 0.16, 2.22, 0.26], [0.21, 0.09, 0.09], "#b7ff7c");
        part(group, "box", [side * 0.16, 2.31, 0.25], [0.28, 0.09, 0.14], "#303a46", [0, 0, side * 0.13]);
        part(group, "octa", [side * 0.28, 1.65, 0.52], [0.54, 0.43, 0.16], "#303a46");
        part(group, "sphere", [side * 0.58, 1.4, 0.08], [0.32, 0.32, 0.32], "#10151c");
        part(group, "box", [side * 0.65, 1.15, 0.16], [0.34, 0.36, 0.35], "#303a46", [0, 0, side * 0.12]);
        part(group, "box", [side * 0.67, 0.92, 0.21], [0.35, 0.24, 0.36], "#252e38");
        part(group, "octa", [side * 0.31, 0.56, 0.16], [0.4, 0.35, 0.25], "#303a46");
        part(group, "box", [side * 0.36, 0.17, 0.33], [0.36, 0.19, 0.35], "#303a46");
        for (let i = 0; i < 2; i++) {
          const start = [side * (0.1 + i * 0.18), 2.06, 0.3];
          const bend = [side * (0.28 + i * 0.25), 1.72 - i * 0.12, 0.72];
          const tip = [side * (0.15 + i * 0.52), 1.45 - i * 0.13, 0.86];
          rod(group, start, bend, 0.09, "#4bd52a");
          rod(group, bend, tip, 0.065, "#8dff4e");
          rod(group, tip, [tip[0] + side * 0.13, tip[1] + 0.05, 1.04], 0.035, "#d4ff9a");
        }
      }
      // RockLobster's asymmetric trim is an interpretation, not canonical artwork.
      if (key === "rocklobster") {
        part(group, "box", [-0.68, 2.02, 0.42], [0.14, 0.37, 0.06], "#d8f0ab", [0, 0, -0.2]);
        part(group, "octa", [0.22, 1.64, 0.68], [0.25, 0.3, 0.1], "#b7ff7c");
      }
      group.scale.set(1.25, 1.1, 1.15);
      break;
  }
  return group;
}

export function programModel(key) {
  if (!PROGRAM_KEYS.includes(key)) return null;
  // Front is +Z, including the face of objects without eyes.
  const group = root(key);
  switch (key) {
    case "eraser":
      part(group, "sphere", [0, 0.54, 0], [1.45, 0.7, 0.98], "#ed81b4");
      part(group, "sphere", [-0.55, 0.42, 0.12], [0.76, 0.5, 0.84], "#f7a9d0");
      part(group, "sphere", [0.56, 0.4, -0.08], [0.65, 0.6, 0.84], "#df609f");
      for (let i = 0; i < 3; i++) {
        part(group, "sphere", [-0.45 + i * 0.45, 0.96 + i * 0.16, 0.02], [0.24, 0.24, 0.24], "#ffd9ef");
      }
      part(group, "sphere", [0.17, 0.69, 0.36], [0.25, 0.18, 0.13], "#ffe5f4");
      for (let i = 0; i < 4; i++) {
        part(group, "sphere", [-0.51 + i * 0.34, 0.43 + (i % 2) * 0.14, 0.35], [0.39, 0.33, 0.34], i % 2 ? "#f7a9d0" : "#ed81b4");
        part(group, "sphere", [-0.43 + i * 0.29, 0.67 + (i % 2) * 0.11, -0.3], [0.34, 0.32, 0.31], "#df609f");
      }
      break;
    case "seeya":
      part(group, "torus", [0.27, 1.26, 0], [1.3, 1.3, 2.8], "#cdd4df");
      part(group, "torus", [0.27, 1.26, 0.12], [1.13, 1.13, 1], "#f6fbff");
      rod(group, [-0.16, 0.8, 0], [-0.88, 0.08, 0], 0.14, "#9ba6b6");
      rod(group, [-0.16, 0.8, 0], [-0.33, 0.63, 0], 0.18, "#e8edf5");
      rod(group, [-0.9, 0.09, 0], [-0.77, 0.22, 0], 0.16, "#d6dce6");
      rod(group, [0.47, 1.56, 0.12], [0.65, 1.37, 0.12], 0.025, "#d5ffff");
      part(group, "torus", [0.27, 1.26, -0.12], [1.13, 1.13, 1], "#9ba6b6");
      for (const side of [-1, 1]) {
        rod(group, [0.27 + side * 0.65, 1.26, -0.1], [0.27 + side * 0.65, 1.26, 0.1], 0.045, "#9ba6b6");
        part(group, "sphere", [0.27 + side * 0.65, 1.26, 0.15], [0.09, 0.09, 0.05], "#f6fbff");
      }
      for (let i = 0; i < 3; i++) {
        const x = -0.48 - i * 0.13, y = 0.48 - i * 0.13;
        rod(group, [x - 0.07, y + 0.07, 0], [x + 0.07, y - 0.07, 0], 0.045, "#e8edf5");
      }
      break;
    case "speedygonzalvez":
      for (let i = 0; i < 5; i++) {
        const size = 0.79 - i * 0.12;
        part(group, "sphere", [0.68 - i * 0.4, 0.45 - i * 0.05, Math.sin(i * 1.7) * 0.2], [size, size * 0.8, size], i % 2 ? "#dcc6a4" : "#bca484");
        part(group, "octa", [0.43 - i * 0.4, 0.77 - i * 0.07, 0.18], [0.13, 0.15, 0.16], "#f0dfbc");
        part(group, "sphere", [0.66 - i * 0.4, 0.31 - i * 0.035, 0.23], [size * 0.72, size * 0.45, size * 0.65], "#dcc6a4");
      }
      rod(group, [-0.83, 0.37, 0.29], [0.74, 0.37, 0.29], 0.025, "#f5e4c7");
      rod(group, [-0.6, 0.57, -0.17], [0.87, 0.57, -0.17], 0.025, "#eed4a7");
      part(group, "sphere", [0.93, 0.46, -0.08], [0.48, 0.52, 0.5], "#bca484");
      // The leading dust puff was on +X; bake this turn into the static mesh.
      group.rotation.y = -Math.PI / 2;
      break;
    case "worm":
      for (let i = 0; i < 6; i++) {
        const x = -0.83 + i * 0.32;
        const y = 0.65 + Math.sin(i * 0.9) * 0.36;
        const z = Math.cos(i * 0.9) * 0.25;
        part(group, "cylinder", [x, y, z], [0.5, 0.29, 0.5], i % 2 ? "#edc45e" : "#a47929", [0, 0, Math.PI / 2]);
        if (i < 5) part(group, "octa", [x, y + 0.27, z], [0.16, 0.18, 0.2], "#ffe49a");
        part(group, "cylinder", [x + 0.11, y, z], [0.53, 0.065, 0.53], "#ffe49a", [0, 0, Math.PI / 2]);
      }
      part(group, "box", [1, 0.37, 0.05], [0.4, 0.4, 0.46], "#e4b94c");
      part(group, "box", [1.22, 0.31, 0.05], [0.045, 0.19, 0.29], "#674e22");
      part(group, "box", [1.16, 0.16, 0.05], [0.25, 0.12, 0.36], "#a47929");
      for (const z of [-0.12, 0.22]) part(group, "sphere", [1.18, 0.48, z], [0.14, 0.14, 0.14], "#62ff39");
      for (const z of [-0.12, 0.22]) part(group, "box", [1.25, 0.48, z], [0.035, 0.08, 0.05], "#674e22");
      for (const z of [-0.14, 0.14]) part(group, "cone", [1.28, 0.37, z], [0.12, 0.36, 0.12], "#e7f8cb", [0, 0, -Math.PI / 2]);
      group.rotation.y = -Math.PI / 2;
      break;
    case "armor": {
      // Open gold framing preserves the see-through silhouette after opaque baking.
      const outline = [[-0.37, 0.55], [-0.53, 1.44], [-0.23, 1.63], [0.23, 1.63], [0.53, 1.44], [0.37, 0.55]];
      for (const z of [-0.25, 0.25]) {
        for (let i = 0; i < outline.length; i++) {
          const a = outline[i], b = outline[(i + 1) % outline.length];
          rod(group, [a[0], a[1], z], [b[0], b[1], z], 0.045, z > 0 ? "#ffe29a" : "#b88e39");
        }
      }
      for (const side of [-1, 1]) {
        rod(group, [side * 0.53, 1.44, -0.25], [side * 0.53, 1.44, 0.25], 0.055, "#e6bc5e");
        rod(group, [side * 0.37, 0.55, -0.25], [side * 0.37, 0.55, 0.25], 0.045, "#e6bc5e");
        part(group, "octa", [side * 0.67, 1.49, 0], [0.63, 0.35, 0.78], "#ffcf6e");
        part(group, "box", [side * 0.24, 0.43, 0.22], [0.33, 0.4, 0.09], "#e8ba57", [0, 0, -side * 0.18]);
      }
      part(group, "torus", [0, 1.65, 0], [0.66, 0.66, 1.8], "#ffe69d", [Math.PI / 2, 0, 0]);
      for (const side of [-1, 1]) {
        rod(group, [side * 0.16, 1.57, 0.26], [side * 0.25, 0.58, 0.26], 0.035, "#ffe29a");
        rod(group, [side * 0.38, 1.33, -0.25], [side * 0.38, 1.33, 0.25], 0.04, "#b88e39");
        part(group, "sphere", [side * 0.67, 1.5, 0.38], [0.12, 0.12, 0.08], "#ffe69d");
        part(group, "box", [side * 0.24, 0.47, 0.28], [0.2, 0.06, 0.04], "#ffe29a", [0, 0, -side * 0.18]);
      }
      for (const y of [0.83, 1.12]) rod(group, [-0.43, y, 0.25], [0.43, y, 0.25], 0.03, "#e6bc5e");
      break;
    }
    case "flak":
      for (let i = 0; i < 5; i++) {
        part(group, "sphere", [-0.7 + i * 0.35, 0.95 + (i % 2) * 0.28, (i % 3) * 0.16], [0.72, 0.67, 0.7], i % 2 ? "#ebf5fc" : "#8baac5");
      }
      for (let i = 0; i < 6; i++) {
        part(group, "octa", [-0.65 + i * 0.26, 0.8 + (i % 3) * 0.23, 0.48 + (i % 2) * 0.12], [0.23, 0.3, 0.24], i % 2 ? "#ffef9e" : "#ffffff");
        part(group, "sphere", [-0.68 + i * 0.27, 0.74 + (i % 2) * 0.4, 0.29], [0.37, 0.35, 0.38], "#ebf5fc");
        rod(group, [-0.65 + i * 0.26, 0.8 + (i % 3) * 0.23, 0.48], [-0.73 + i * 0.26, 0.97 + (i % 3) * 0.23, 0.56], 0.025, "#ffffff");
      }
      break;
    case "shield":
      for (let i = -1; i <= 1; i++) {
        part(group, "box", [i * 0.49, 1, Math.abs(i) * 0.19], [0.52, 1.52, 0.22], i ? "#acbac9" : "#e5f3fa", [0, -i * 0.33, 0]);
        part(group, "box", [i * 0.49, 1.77, Math.abs(i) * 0.19], [0.52, 0.11, 0.29], "#edf1f8", [0, -i * 0.33, 0]);
      }
      part(group, "octa", [0, 0.25, 0], [1.53, 0.61, 0.3], "#8a9caf");
      part(group, "box", [0, 1.02, 0.15], [0.14, 1.34, 0.1], "#abb7ca");
      part(group, "octa", [0, 1.15, 0.23], [0.39, 0.49, 0.15], "#ffffff");
      for (const side of [-1, 1]) {
        rod(group, [side * 0.74, 0.28, 0.22], [side * 0.74, 1.73, 0.22], 0.045, "#edf1f8");
        for (const y of [0.5, 1.5]) part(group, "sphere", [side * 0.5, y, 0.32], [0.11, 0.11, 0.07], "#edf1f8");
        rod(group, [side * 0.21, 0.81, -0.12], [side * 0.21, 0.81, -0.34], 0.055, "#8a9caf");
      }
      rod(group, [-0.21, 0.81, -0.34], [0.21, 0.81, -0.34], 0.065, "#abb7ca");
      rod(group, [-0.4, 1.35, -0.12], [0.4, 1.35, -0.12], 0.045, "#8a9caf");
      break;
    case "banhammer":
      rod(group, [0, 0.1, 0], [0, 1.53, 0], 0.105, "#414663");
      part(group, "box", [0, 1.56, 0], [1.44, 0.66, 0.64], "#b4baff");
      for (const side of [-1, 1]) part(group, "box", [side * 0.68, 1.56, 0], [0.14, 0.77, 0.76], "#eff2ff");
      part(group, "box", [0, 1.56, 0.34], [0.29, 0.54, 0.06], "#ff9cea");
      part(group, "cylinder", [0, 0.13, 0], [0.3, 0.18, 0.3], "#e6b0db");
      for (const side of [-1, 1]) part(group, "box", [0, 1.56 + side * 0.27, 0.34], [1.26, 0.055, 0.05], "#f9d5ff");
      part(group, "cylinder", [0, 1.18, 0], [0.3, 0.16, 0.3], "#eff2ff");
      for (let i = 0; i < 4; i++) part(group, "cylinder", [0, 0.35 + i * 0.17, 0], [0.24, 0.06, 0.24], "#747ba7");
      for (const side of [-1, 1]) {
        part(group, "box", [side * 0.77, 1.56, 0], [0.035, 0.53, 0.52], "#747ba7");
        part(group, "sphere", [side * 0.49, 1.56, 0.34], [0.11, 0.11, 0.06], "#eff2ff");
      }
      break;
    case "sword":
      part(group, "box", [0, 1.2, 0], [0.16, 1.23, 0.09], "#76e9ff", [0, 0, -0.12]);
      part(group, "box", [0.12, 1.96, 0], [0.14, 0.43, 0.09], "#9df9ff", [0, 0, -0.31]);
      part(group, "box", [-0.04, 1.2, 0.05], [0.035, 1.23, 0.025], "#ffffff", [0, 0, -0.12]);
      part(group, "cone", [0.21, 2.2, 0], [0.14, 0.23, 0.09], "#e6ffff", [0, 0, -0.35]);
      part(group, "box", [-0.08, 0.55, 0], [0.59, 0.11, 0.32], "#d5b55e");
      rod(group, [-0.08, 0.52, 0], [-0.08, 0.04, 0], 0.085, "#29384e");
      for (let i = 0; i < 3; i++) part(group, "box", [-0.08, 0.12 + i * 0.13, 0], [0.19, 0.055, 0.18], "#e37177", [0, 0, -0.35]);
      part(group, "sphere", [-0.08, 0.01, 0], [0.23, 0.2, 0.23], "#d5b55e");
      part(group, "cylinder", [-0.08, 0.48, 0], [0.2, 0.09, 0.2], "#d5b55e");
      for (const side of [-1, 1]) part(group, "octa", [-0.08 + side * 0.3, 0.55, 0], [0.15, 0.16, 0.34], "#d5b55e");
      part(group, "box", [0.04, 1.22, 0.052], [0.035, 1.15, 0.025], "#e6ffff", [0, 0, -0.12]);
      break;
    case "deckkrash":
      for (let i = -1; i <= 1; i++) {
        const y = i === 0 ? 0.88 : 0.65;
        part(group, "cylinder", [i * 0.37, y, 0], [0.4, 1.23, 0.4], "#e84439");
        for (const side of [-1, 1]) part(group, "cylinder", [i * 0.37, y + side * 0.61, 0], [0.4, 0.06, 0.4], "#e7ae7c");
      }
      part(group, "box", [0, 0.77, 0.21], [1.18, 0.2, 0.12], "#343b51");
      rod(group, [0, 1.5, 0], [0.23, 1.76, 0], 0.035, "#d6bf99");
      part(group, "octa", [0.26, 1.79, 0], [0.25, 0.32, 0.24], "#fff087");
      part(group, "octa", [0.52, 1.9, 0], [0.11, 0.25, 0.1], "#ffb34d", [0, 0, -0.7]);
      part(group, "octa", [0.14, 2.02, 0], [0.1, 0.24, 0.1], "#fff6be", [0, 0, 0.35]);
      part(group, "box", [0, 0.77, -0.21], [1.18, 0.2, 0.12], "#343b51");
      for (const side of [-1, 1]) part(group, "box", [side * 0.57, 0.77, 0], [0.08, 0.2, 0.54], "#343b51");
      part(group, "box", [0, 0.77, 0.3], [0.27, 0.3, 0.09], "#e7ae7c");
      part(group, "box", [0, 0.77, 0.35], [0.13, 0.15, 0.04], "#343b51");
      rod(group, [0.2, 1.05, 0.1], [0.16, 1.35, 0.1], 0.035, "#d6bf99");
      rod(group, [0.16, 1.35, 0.1], [0, 1.5, 0], 0.035, "#d6bf99");
      break;
    case "hellbolt":
      rod(group, [0.48, 1.93, 0], [-0.33, 1.07, 0.06], 0.12, "#dc123c");
      rod(group, [-0.33, 1.07, 0.06], [0.28, 1.14, 0.09], 0.14, "#ff4c65");
      rod(group, [0.28, 1.14, 0.09], [-0.3, 0.27, 0.15], 0.12, "#be0d32");
      part(group, "cone", [-0.33, 0.25, 0.15], [0.43, 0.58, 0.36], "#ed1c44", [0, 0, Math.PI]);
      part(group, "octa", [-0.55, 1.72, -0.11], [0.22, 0.46, 0.2], "#9f284a", [0, 0, -0.6]);
      part(group, "octa", [0.62, 0.8, -0.07], [0.2, 0.43, 0.23], "#ffbcac", [0, 0, 0.5]);
      rod(group, [0.46, 1.92, 0.12], [-0.33, 1.07, 0.18], 0.035, "#ffbcac");
      rod(group, [-0.33, 1.07, 0.18], [0.28, 1.14, 0.21], 0.04, "#ffbcac");
      rod(group, [0.28, 1.14, 0.21], [-0.3, 0.27, 0.27], 0.03, "#ffbcac");
      rod(group, [-0.12, 1.29, 0.03], [-0.55, 1.72, -0.11], 0.05, "#dc123c");
      rod(group, [0.12, 0.9, 0.11], [0.62, 0.8, -0.07], 0.05, "#ff4c65");
      break;
    case "nervescrub":
      part(group, "sphere", [0, 1, 0], [1.2, 1.2, 1.2], "#c4ccd8");
      part(group, "torus", [0, 1, 0], [1.25, 1.25, 1.8], "#f2f6ff");
      part(group, "torus", [0, 1, 0], [1.25, 1.25, 1.8], "#73839a", [Math.PI / 2, 0, 0]);
      part(group, "octa", [-0.19, 1.26, 0.5], [0.21, 0.39, 0.12], "#ffffff");
      for (const side of [-1, 1]) {
        part(group, "cone", [side * 0.62, 1, 0], [0.27, 0.43, 0.27], "#7de7ff", [0, 0, -side * Math.PI / 2]);
        rod(group, [side * 0.49, 1.37, 0], [side * 0.31, 1.76, 0.08], 0.035, "#e0ffff");
        rod(group, [side * 0.31, 1.76, 0.08], [side * 0.61, 1.93, 0.16], 0.035, "#7de7ff");
        part(group, "cylinder", [side * 0.57, 1, 0], [0.32, 0.17, 0.32], "#73839a", [0, 0, Math.PI / 2]);
        part(group, "sphere", [side * 0.31, 1.76, 0.08], [0.14, 0.14, 0.14], "#f2f6ff");
        rod(group, [side * 0.25, 0.7, 0.47], [side * 0.37, 0.86, 0.47], 0.025, "#73839a");
      }
      part(group, "torus", [0, 1, 0.59], [0.32, 0.32, 0.8], "#f2f6ff");
      part(group, "sphere", [0, 1, 0.59], [0.23, 0.23, 0.09], "#73839a");
      break;
    case "poisonflatline":
      part(group, "box", [-0.92, 0.65, 0], [0.3, 0.36, 0.34], "#3c4759");
      part(group, "box", [-0.59, 0.68, 0], [0.48, 0.54, 0.38], "#748093");
      for (let i = 0; i < 3; i++) {
        const y = 0.48 + i * 0.14;
        rod(group, [-0.58, y, 0.23], [-0.29, y, 0.23], 0.06, "#b5c0ce");
        part(group, "octa", [-0.27, y, 0.23], [0.15, 0.14, 0.17], "#747e8f");
      }
      rod(group, [-0.51, 0.91, 0.09], [-0.12, 0.95, 0.09], 0.075, "#c6ced9");
      rod(group, [-0.12, 0.95, 0.09], [0.18, 0.95, 0.09], 0.065, "#dfe8e6");
      rod(group, [-0.69, 0.66, 0.21], [-0.42, 0.86, 0.35], 0.075, "#a2adbd");
      rod(group, [0.18, 0.95, 0.09], [1.36, 0.95, 0.09], 0.055, "#60ff1b");
      rod(group, [0.2, 0.95, 0.13], [1.36, 0.95, 0.13], 0.018, "#e1ffb2");
      part(group, "torus", [0.25, 0.95, 0.09], [0.24, 0.24, 1.2], "#9dff55", [0, Math.PI / 2, 0]);
      for (let i = 0; i < 3; i++) {
        const y = 0.48 + i * 0.14;
        rod(group, [-0.48, y - 0.045, 0.27], [-0.48, y + 0.045, 0.27], 0.025, "#3c4759");
        part(group, "box", [-0.27, y, 0.31], [0.1, 0.08, 0.045], "#dfe8e6");
      }
      part(group, "box", [-0.91, 0.65, 0.19], [0.09, 0.26, 0.06], "#b5c0ce");
      part(group, "sphere", [-0.36, 0.92, 0.09], [0.2, 0.2, 0.2], "#748093");
      part(group, "cone", [1.43, 0.95, 0.09], [0.11, 0.18, 0.11], "#e1ffb2", [0, 0, -Math.PI / 2]);
      group.rotation.y = -Math.PI / 2;
      break;
    case "superglue":
      part(group, "sphere", [0, 0.69, 0], [1.1, 1.07, 0.95], "#bd303e");
      part(group, "sphere", [-0.52, 0.43, 0.13], [0.83, 0.55, 0.8], "#e64b52");
      part(group, "sphere", [0.47, 0.37, -0.13], [0.84, 0.51, 0.79], "#92273e");
      part(group, "sphere", [0.28, 1.07, 0], [0.49, 0.54, 0.45], "#f67074");
      for (const side of [-1, 1]) {
        rod(group, [side * 0.36, 0.88, 0.12], [side * 0.94, 1.18, 0.15], 0.045, "#ff9290");
        part(group, "sphere", [side * 0.96, 1.2, 0.15], [0.24, 0.31, 0.25], "#ed6467");
      }
      part(group, "cone", [0.12, 0.17, 0.43], [0.23, 0.52, 0.24], "#df4350", [0, 0, Math.PI]);
      for (let i = 0; i < 4; i++) {
        const x = -0.54 + i * 0.34, y = 0.47 + (i % 2) * 0.16;
        part(group, "sphere", [x, y, 0.36], [0.3, 0.31, 0.27], i % 2 ? "#ed6467" : "#bd303e");
        rod(group, [x, y, 0.36], [x + 0.05, 0.12, 0.41], 0.055, "#df4350");
        part(group, "sphere", [x + 0.05, 0.12, 0.41], [0.18, 0.19, 0.18], "#ed6467");
      }
      break;
    case "vrizzbolt":
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        const b = (i + 1) * Math.PI / 3;
        for (const side of [-1, 1]) {
          rod(group, [side * Math.cos(a) * 0.43, 0.17 + i * 0.28, side * Math.sin(a) * 0.43],
            [side * Math.cos(b) * 0.43, 0.45 + i * 0.28, side * Math.sin(b) * 0.43], 0.075, side < 0 ? "#ef67dc" : "#6cf5ff");
          part(group, "sphere", [side * Math.cos(a) * 0.43, 0.17 + i * 0.28, side * Math.sin(a) * 0.43], [0.19, 0.19, 0.19], side < 0 ? "#ef67dc" : "#6cf5ff");
        }
        rod(group, [-Math.cos(a) * 0.43, 0.17 + i * 0.28, -Math.sin(a) * 0.43],
          [Math.cos(a) * 0.43, 0.17 + i * 0.28, Math.sin(a) * 0.43], 0.038, "#e4eaff");
      }
      rod(group, [-0.43, 0.04, 0], [0.43, 0.04, 0], 0.09, "#e4eaff");
      rod(group, [-0.43, 0.04, 0], [-0.43, 0.17, 0], 0.06, "#ef67dc");
      rod(group, [0.43, 0.04, 0], [0.43, 0.17, 0], 0.06, "#6cf5ff");
      rod(group, [-0.43, 1.85, 0], [0.43, 1.85, 0], 0.055, "#e4eaff");
      break;
  }
  return group;
}
