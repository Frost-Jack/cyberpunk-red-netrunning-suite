/* Pure NET floor topology. Array order is presentation, not connectivity. */
export function topology(arch) {
  const floors = Array.isArray(arch?.floors) ? arch.floors : [];
  const parents = floors.map(() => null);
  const children = floors.map(() => []);
  const depths = floors.map(() => -1);
  const result = { parents, children, depths, rootIndex: -1, branched: false, error: null };
  const invalid = () => { result.error = "CRNS.Errors.InvalidTopology"; return result; };
  const byId = new Map();
  for (const [i, f] of floors.entries()) {
    if (typeof f?.id !== "string" || !f.id || byId.has(f.id)) return invalid();
    byId.set(f.id, i);
  }
  if (!floors.length) return invalid();
  for (const [i, f] of floors.entries()) {
    if (Object.hasOwn(f, "parentId")) {
      if (f.parentId === "") continue;
      if (!byId.has(f.parentId)) return invalid();
      parents[i] = byId.get(f.parentId);
    } else parents[i] = i ? i - 1 : null;
    if (parents[i] !== null) children[parents[i]].push(i);
  }
  result.branched = children.some((c) => c.length > 1);
  const roots = parents.flatMap((p, i) => p === null ? [i] : []);
  if (roots.length !== 1) return invalid();
  const queue = [roots[0]];
  depths[roots[0]] = 0;
  for (let n = 0; n < queue.length; n++) {
    const i = queue[n];
    for (const child of children[i]) {
      if (depths[child] !== -1) return invalid();
      depths[child] = depths[i] + 1;
      queue.push(child);
    }
  }
  if (queue.length !== floors.length) return invalid();
  if (children.some((c, i) => c.length > 1 && depths[i] < 1)) {
    result.error = "CRNS.Errors.EarlyBranch";
    return result;
  }
  const leaves = queue.filter((i) => !children[i].length);
  const deepest = Math.max(...leaves.map((i) => depths[i]));
  const bottoms = leaves.filter((i) => depths[i] === deepest);
  if (bottoms.length !== 1) result.error = "CRNS.Errors.AmbiguousRoot";
  else result.rootIndex = bottoms[0];
  return result;
}

export function visibleFloorIds(session, pid, arch) {
  const visible = new Set();
  const graph = topology(arch);
  if (graph.error) return visible;
  const floors = arch.floors;
  const part = session?.participants?.[pid];
  if (!part || part.archId !== arch.id) return visible;
  const ids = new Set(floors.map((f) => f.id));
  for (const id of part.visitedFloorIds || []) if (ids.has(id)) visible.add(id);
  const reveal = session?.reveal?.[pid]?.[arch.id];
  if (Array.isArray(reveal)) for (const id of reveal) if (ids.has(id)) visible.add(id);
  // Numeric fog belongs only to old, implicitly linked linear architectures.
  if (floors.every((f) => !Object.hasOwn(f, "parentId"))) {
    const max = Math.max(Number(part.maxFloor) || 0, Number.isFinite(reveal) ? reveal : -1);
    floors.forEach((f, i) => { if (i <= max) visible.add(f.id); });
  }
  let i = Number(part.floorIndex) || 0;
  while (floors[i]) {
    visible.add(floors[i].id);
    if (graph.parents[i] === null) break;
    i = graph.parents[i];
  }
  return visible;
}

export function pathfinderFloors(arch, start, total, isBlocking) {
  const graph = topology(arch);
  if (graph.error || !arch.floors[start]) return [];
  const limit = Math.max(0, Math.floor(Number(total) || 0));
  const queue = [[start, 0]];
  const revealed = [];
  for (let n = 0; n < queue.length; n++) {
    const [i, distance] = queue[n];
    const floor = arch.floors[i];
    revealed.push(floor.id);
    if (distance >= limit || isBlocking(floor)) continue;
    for (const child of graph.children[i]) queue.push([child, distance + 1]);
  }
  return revealed;
}
