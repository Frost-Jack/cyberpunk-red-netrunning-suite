import * as THREE from "../../vendor/three/three.module.min.js";
export { THREE };

export function root(key) { const group = new THREE.Group(); group.name = key; group.userData.modelKey = key; return group; }
const geometries = new Map();
function geometry(shape) {
  if (geometries.has(shape)) return geometries.get(shape);
  const constructors = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    sphere: () => new THREE.SphereGeometry(0.5, 10, 7),
    cone: () => new THREE.ConeGeometry(0.5, 1, 8),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    octa: () => new THREE.OctahedronGeometry(0.5),
    tetra: () => new THREE.TetrahedronGeometry(0.5),
    torus: () => new THREE.TorusGeometry(0.5, 0.045, 4, 18),
  };
  const result = (constructors[shape] || constructors.box)();
  geometries.set(shape, result); return result;
}
/** Primitive dimensions are one unit; cone/cylinder are Y-up, torus is in XY. */
export function part(group, shape, position = [0, 0, 0], scale = [1, 1, 1], color = "#47cbd1", rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry(shape), new THREE.MeshBasicMaterial({ color }));
  mesh.position.fromArray(position); mesh.scale.fromArray(scale); mesh.rotation.fromArray(rotation);
  group.add(mesh); return mesh;
}
export function rod(group, a, b, radius = 0.045, color = "#47cbd1") {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
  const mesh = part(group, "cylinder", from.clone().add(to).multiplyScalar(0.5).toArray(), [radius * 2, direction.length(), radius * 2], color);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); return mesh;
}
export function ribbon(group, points, color = "#47cbd1") {
  const geo = new THREE.BufferGeometry();
  const vertices = [];
  for (let i = 1; i < points.length - 1; i++) vertices.push(...points[0], ...points[i], ...points[i + 1]);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); group.add(mesh); return mesh;
}
/** Bake primitive transforms/colors into one solid mesh and one edge mesh.
 * Models stand on local Y=0 and fit a 2.6 x 2.6 x 2.8 unit display volume. */
export function bakeModel(group) {
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3());
  const scale = Math.min(2.6 / Math.max(size.x, size.z, 0.01), 2.8 / Math.max(size.y, 0.01));
  const center = bounds.getCenter(new THREE.Vector3());
  const normalize = new THREE.Matrix4().makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const positions = [], normals = [], colors = [], materials = new Set();
  const temporary = new Set();
  group.traverse(object => {
    if (!object.isMesh) return;
    let geo = object.geometry.clone().applyMatrix4(object.matrixWorld).applyMatrix4(normalize);
    if (geo.index) { const indexed = geo; geo = indexed.toNonIndexed(); indexed.dispose(); }
    const p = geo.getAttribute("position"), n = geo.getAttribute("normal"), color = object.material.color;
    for (let i = 0; i < p.count; i++) { positions.push(p.getX(i), p.getY(i), p.getZ(i)); normals.push(n.getX(i), n.getY(i), n.getZ(i)); colors.push(color.r, color.g, color.b); }
    geo.dispose(); materials.add(object.material);
    if (![...geometries.values()].includes(object.geometry)) temporary.add(object.geometry);
  });
  for (const geo of temporary) geo.dispose();
  for (const material of materials) material.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox.min.y, 0);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { key: group.name, geometry, edges: new THREE.EdgesGeometry(geometry, 28), bounds: geometry.boundingBox.clone() };
}
export function disposePrimitiveCache() { for (const geo of geometries.values()) geo.dispose(); geometries.clear(); }
