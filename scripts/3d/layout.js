/** Layout is independent of camera, hover and selection. All models stand above
 * opaque platforms; growing an occupied floor pushes its descendants away. */
export function layoutArchitecture(nodes = []) {
  const floors = nodes.map(node => {
    if (node.isFog) return { node, width: 10, depth: 7, entities: [] };
    const occupants = [...(node.participants || []), ...(node.entities || [])];
    const counts = occupants.map(owner => (owner.progMinis || []).length);
    const rings = Math.max(occupants.some(owner => owner.ref?.startsWith("runner:")) ? 1 : 0, Math.ceil(Math.max(0, ...counts) / 8));
    const pitch = rings ? 2 * (3.4 + (rings - 1) * 2.8 + 1.3) : 6;
    const columns = Math.min(rings ? 3 : 4, Math.max(1, occupants.length));
    const rows = Math.max(1, Math.ceil(occupants.length / columns));
    const width = Math.max(20, columns * pitch + 4);
    const depth = Math.max(11, rows * pitch + 4);
    const entities = occupants.map((entity, i) => ({ entity,
      kind: entity.ref?.startsWith("runner:") ? "runner" : "ice", scale: 1.35,
      localX: (i % columns - (columns - 1) / 2) * pitch,
      localZ: (Math.floor(i / columns) - (rows - 1) / 2) * pitch }));
    for (const owner of [...entities]) (owner.entity.progMinis || []).forEach((program, i) => {
      const ring = Math.floor(i / 8), count = Math.min(8, owner.entity.progMinis.length - ring * 8);
      const angle = (i % 8) * 2 * Math.PI / count + Math.PI / 4, radius = 3.4 + ring * 2.8;
      entities.push({ entity: { ...program, ownerRef: owner.entity.ref, color: program.color || owner.entity.color, img: program.img || owner.entity.img },
        kind: "mini", scale: 0.75,
        localX: owner.localX + Math.sin(angle) * radius, localZ: owner.localZ + Math.cos(angle) * radius });
    });
    return { node, width, depth, entities };
  });
  const depths = new Map();
  for (const floor of floors) {
    const row = Math.max(0, (Number(floor.node.row) || 1) - 1);
    depths.set(row, Math.max(depths.get(row) || 0, floor.depth));
  }
  const offsets = new Map(); let z = 0, previous = 0;
  for (const row of [...depths.keys()].sort((a, b) => a - b)) {
    const size = depths.get(row);
    if (offsets.size) z += previous / 2 + size / 2 + 12;
    offsets.set(row, z); previous = size;
  }
  const columnPitch = Math.max(36, ...floors.map(f => f.width + (!f.node.isFog && f.node.demonEntities?.length ? f.node.demonEntities.length * 5 + 2 : 0))) + 10;
  for (const floor of floors) {
    const row = Math.max(0, (Number(floor.node.row) || 1) - 1);
    floor.x = ((Number(floor.node.column) || 1) - 1) * columnPitch;
    floor.y = -row * 4; floor.z = offsets.get(row);
    for (const record of floor.entities) {
      record.x = floor.x + record.localX; record.y = floor.y + 0.06; record.z = floor.z + record.localZ; record.floor = floor;
    }
    if (!floor.node.isFog) (floor.node.demonEntities || []).forEach((entity, i) => floor.entities.push({
      entity, kind: "demon", scale: 1.5, floor, x: floor.x - floor.width / 2 - 5 - i * 5,
      y: floor.y + 0.36, z: floor.z, pedestal: true,
    }));
  }
  return floors;
}
