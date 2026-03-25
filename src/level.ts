import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  TransformNode,
} from '@babylonjs/core'

/** Seeded PRNG (mulberry32) so levels are reproducible per round */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

export interface WallDef {
  x: number; y: number; z: number
  w: number; h: number; d: number
  color: 'red' | 'blue'
}

export interface LevelData {
  walls: WallDef[]
  flagX: number
  flagZ: number
  enemySpawns: { x: number; z: number }[]
  playerSpawnX: number
  playerSpawnZ: number
}

/**
 * Generate a level layout for the given round.
 * More walls and enemies each round.
 */
export function generateLevel(round: number, worldMinX: number, worldMaxX: number, worldMinZ: number, worldMaxZ: number): LevelData {
  const rng = mulberry32(round * 7919 + 1337)

  const margin = 6
  const minX = worldMinX + margin
  const maxX = worldMaxX - margin
  const minZ = worldMinZ + margin
  const maxZ = worldMaxZ - margin
  const rangeX = maxX - minX
  const rangeZ = maxZ - minZ

  // Player always spawns near origin
  const playerSpawnX = 0
  const playerSpawnZ = 0

  // Flag spawns far from player — in a random quadrant at ~70-90% of map distance
  const quadrant = Math.floor(rng() * 4)
  const flagDist = 0.7 + rng() * 0.2
  let flagX: number, flagZ: number
  switch (quadrant) {
    case 0: flagX = minX + rangeX * flagDist; flagZ = minZ + rangeZ * flagDist; break
    case 1: flagX = minX + rangeX * (1 - flagDist); flagZ = minZ + rangeZ * flagDist; break
    case 2: flagX = minX + rangeX * flagDist; flagZ = minZ + rangeZ * (1 - flagDist); break
    default: flagX = minX + rangeX * (1 - flagDist); flagZ = minZ + rangeZ * (1 - flagDist); break
  }

  // Generate walls — more each round
  const wallCount = 15 + round * 5
  const walls: WallDef[] = []

  for (let i = 0; i < wallCount; i++) {
    const wx = minX + rng() * rangeX
    const wz = minZ + rng() * rangeZ

    // Skip walls that would block the spawn or flag
    if (Math.abs(wx - playerSpawnX) < 8 && Math.abs(wz - playerSpawnZ) < 8) continue
    if (Math.abs(wx - flagX) < 6 && Math.abs(wz - flagZ) < 6) continue

    const isLong = rng() > 0.5
    const w = isLong ? 1.5 + rng() * 2 : 6 + rng() * 14
    const d = isLong ? 6 + rng() * 14 : 1.5 + rng() * 2
    const h = 3 + rng() * 4
    const color: 'red' | 'blue' = rng() > 0.5 ? 'red' : 'blue'

    walls.push({ x: wx - w / 2, y: 0, z: wz - d / 2, w, h, d, color })
  }

  // Add some building clusters (4 walls around a space)
  const buildingCount = 2 + Math.floor(round * 0.5)
  for (let i = 0; i < buildingCount; i++) {
    const bx = minX + 10 + rng() * (rangeX - 20)
    const bz = minZ + 10 + rng() * (rangeZ - 20)
    if (Math.abs(bx - playerSpawnX) < 12 && Math.abs(bz - playerSpawnZ) < 12) continue

    const bw = 8 + rng() * 6
    const bd = 8 + rng() * 6
    const bh = 3 + rng() * 3
    const thick = 1.5
    const bColor: 'red' | 'blue' = rng() > 0.5 ? 'red' : 'blue'

    walls.push({ x: bx, y: 0, z: bz, w: bw, h: bh, d: thick, color: bColor })
    walls.push({ x: bx, y: 0, z: bz + bd - thick, w: bw, h: bh, d: thick, color: bColor })
    walls.push({ x: bx, y: 0, z: bz + thick, w: thick, h: bh, d: bd - thick * 2, color: bColor })
    walls.push({ x: bx + bw - thick, y: 0, z: bz + thick, w: thick, h: bh, d: bd - thick * 2, color: bColor })
  }

  // Enemy spawns — scattered around, not near player spawn
  const enemyCount = 3 + round * 2
  const enemySpawns: { x: number; z: number }[] = []
  for (let i = 0; i < enemyCount; i++) {
    let ex: number, ez: number
    let attempts = 0
    do {
      ex = minX + rng() * rangeX
      ez = minZ + rng() * rangeZ
      attempts++
    } while (Math.sqrt(ex * ex + ez * ez) < 20 && attempts < 30)
    enemySpawns.push({ x: ex, z: ez })
  }

  return { walls, flagX, flagZ, enemySpawns, playerSpawnX, playerSpawnZ }
}

// Shared materials (created once per scene)
let redMat: StandardMaterial | null = null
let blueMat: StandardMaterial | null = null

function getWallMaterial(scene: Scene, color: 'red' | 'blue'): StandardMaterial {
  if (color === 'red') {
    if (!redMat || redMat.getScene() !== scene) {
      redMat = new StandardMaterial('wallRed', scene)
      redMat.diffuseColor = new Color3(0.75, 0.15, 0.12)
      redMat.specularColor = new Color3(0.15, 0.05, 0.05)
    }
    return redMat
  } else {
    if (!blueMat || blueMat.getScene() !== scene) {
      blueMat = new StandardMaterial('wallBlue', scene)
      blueMat.diffuseColor = new Color3(0.15, 0.25, 0.75)
      blueMat.specularColor = new Color3(0.05, 0.05, 0.15)
    }
    return blueMat
  }
}

/**
 * Create solid box meshes for all walls. Returns array of meshes for disposal.
 */
export function createWallMeshes(scene: Scene, walls: WallDef[], getSurfaceY: (x: number, z: number) => number): Mesh[] {
  const meshes: Mesh[] = []
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]
    const cx = w.x + w.w / 2
    const cz = w.z + w.d / 2
    const surfY = getSurfaceY(cx, cz)
    const baseY = Math.max(surfY, w.y)

    const box = MeshBuilder.CreateBox(`wall_${i}`, {
      width: w.w,
      height: w.h,
      depth: w.d,
    }, scene)
    box.position.set(cx, baseY + w.h / 2, cz)
    box.material = getWallMaterial(scene, w.color)
    box.checkCollisions = true
    meshes.push(box)
  }
  return meshes
}

/**
 * Create the red flag mesh.
 */
export function createFlag(scene: Scene, x: number, z: number, surfaceY: number): Mesh {
  // Pole
  const pole = MeshBuilder.CreateCylinder('flagPole', { height: 6, diameter: 0.2 }, scene)
  pole.position.set(x, surfaceY + 3, z)
  const poleMat = new StandardMaterial('poleMat', scene)
  poleMat.diffuseColor = new Color3(0.6, 0.6, 0.6)
  pole.material = poleMat

  // Flag cloth — a flat box
  const flag = MeshBuilder.CreateBox('flagCloth', { width: 2.5, height: 1.5, depth: 0.05 }, scene)
  flag.position.set(x + 1.25, surfaceY + 5.25, z)
  const flagMat = new StandardMaterial('flagMat', scene)
  flagMat.diffuseColor = new Color3(0.9, 0.1, 0.1)
  flagMat.emissiveColor = new Color3(0.3, 0.02, 0.02)
  flag.material = flagMat

  // Base ring
  const base = MeshBuilder.CreateTorus('flagBase', { diameter: 1.5, thickness: 0.3, tessellation: 16 }, scene)
  base.position.set(x, surfaceY + 0.15, z)
  const baseMat = new StandardMaterial('flagBaseMat', scene)
  baseMat.diffuseColor = new Color3(0.9, 0.85, 0.1)
  baseMat.emissiveColor = new Color3(0.2, 0.18, 0.0)
  base.material = baseMat

  // Group under a parent for easy disposal
  const parent = new Mesh('flagGroup', scene)
  pole.parent = parent
  flag.parent = parent
  base.parent = parent

  return parent
}
