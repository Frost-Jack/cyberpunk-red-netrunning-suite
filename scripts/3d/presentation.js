/** Screen-space drag projected onto the horizontal architecture plane. */
export function panCamera(camera, dx, dy, height) {
  const units = 26 / (Math.max(1, height) * camera.zoom);
  const vertical = dy * units / Math.sin(camera.elevation);
  return { ...camera,
    x: camera.x - dx * units * Math.cos(camera.yaw) - vertical * Math.sin(camera.yaw),
    z: camera.z + dx * units * Math.sin(camera.yaw) - vertical * Math.cos(camera.yaw),
  };
}

export function facingYaw(record, target, fallback = 0) {
  if (!target || Math.hypot(target.x - record.x, target.z - record.z) < 0.001) return fallback;
  return Math.atan2(target.x - record.x, target.z - record.z);
}

export function affiliationColor(entity, kind) {
  const custom = entity.visual?.color;
  const color = /^#[\da-f]{6}$/i.test(String(custom || "")) ? custom : entity.owner?.color || entity.color;
  return /^#[\da-f]{6}$/i.test(String(color || "")) ? color : kind === "runner" || kind === "mini" ? "#72bfcc" : kind === "demon" ? "#d6a64f" : "#cf7568";
}
