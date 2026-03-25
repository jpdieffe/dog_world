import {
  Scene,
  Mesh,
  VertexData,
  StandardMaterial,
  Color3,
  Texture,
  Vector3,
} from '@babylonjs/core'
import { marchingCubes } from './marching-cubes'

// ── Terrain configuration ──────────────────────────────────────────────────────
/** Number of density samples per chunk along each axis */
const CHUNK_SAMPLES = 16
/** World-space size of each chunk (metres) */
const CHUNK_SIZE = 16
/** Cell size (world units per density sample) */
const CELL_SIZE = CHUNK_SIZE / (CHUNK_SAMPLES - 1)
/** How many chunks along each horizontal axis  (total area = GRID × CHUNK_SIZE) */
const GRID = 4
/** Vertical samples  — enough for ~10m below ground + ~4m above */
const VERT_SAMPLES = 16
/** Y offset: grid starts at this Y, surface should be near y=0 */
const Y_OFFSET = -10
/** Dig radius in world units */
const DIG_RADIUS = 2.0
/** Dig strength (how much density is removed per click) */
const DIG_STRENGTH = 1.5

export class Terrain {
  private scene: Scene
  private chunks = new Map<string, TerrainChunk>()
  private material: StandardMaterial

  /** Total world extents */
  readonly worldMinX: number
  readonly worldMinZ: number
  readonly worldMaxX: number
  readonly worldMaxZ: number

  constructor(scene: Scene) {
    this.scene = scene

    // Centre the grid around the origin
    const half = (GRID * CHUNK_SIZE) / 2
    this.worldMinX = -half
    this.worldMinZ = -half
    this.worldMaxX = half
    this.worldMaxZ = half

    // Shared ground material — diffuse white so vertex colours control the final look
    this.material = new StandardMaterial('terrainMat', scene)
    this.material.diffuseColor = new Color3(1, 1, 1)
    this.material.specularColor = new Color3(0.05, 0.05, 0.05)
    this.material.backFaceCulling = false // see inside tunnels

    // Create all chunks
    for (let cz = 0; cz < GRID; cz++) {
      for (let cx = 0; cx < GRID; cx++) {
        const key = `${cx},${cz}`
        const chunk = new TerrainChunk(
          scene,
          this.material,
          cx, cz,
          this.worldMinX + cx * CHUNK_SIZE,
          Y_OFFSET,
          this.worldMinZ + cz * CHUNK_SIZE,
        )
        this.chunks.set(key, chunk)
      }
    }
  }

  /**
   * Dig a sphere out of the terrain at the given world position.
   * Returns true if any chunk was modified.
   */
  dig(worldX: number, worldY: number, worldZ: number, radius = DIG_RADIUS): boolean {
    let modified = false
    // Find all chunks whose bounding box intersects the dig sphere
    for (const [, chunk] of this.chunks) {
      if (chunk.intersectsSphere(worldX, worldY, worldZ, radius)) {
        chunk.subtractSphere(worldX, worldY, worldZ, radius, DIG_STRENGTH)
        chunk.rebuild()
        modified = true
      }
    }
    return modified
  }

  /**
   * Get the terrain surface Y at a given (x, z) world position.
   * Used for player ground collision.
   * Returns the highest solid density boundary Y, or a default.
   */
  getSurfaceY(worldX: number, worldZ: number): number {
    const cx = Math.floor((worldX - this.worldMinX) / CHUNK_SIZE)
    const cz = Math.floor((worldZ - this.worldMinZ) / CHUNK_SIZE)
    const key = `${cx},${cz}`
    const chunk = this.chunks.get(key)
    if (!chunk) return 0

    return chunk.getSurfaceY(worldX, worldZ)
  }

  /**
   * Check if a position is inside solid terrain.
   */
  isSolid(worldX: number, worldY: number, worldZ: number): boolean {
    const cx = Math.floor((worldX - this.worldMinX) / CHUNK_SIZE)
    const cz = Math.floor((worldZ - this.worldMinZ) / CHUNK_SIZE)
    const key = `${cx},${cz}`
    const chunk = this.chunks.get(key)
    if (!chunk) return false
    return chunk.getDensityAt(worldX, worldY, worldZ) > 0
  }
}

// ── Individual chunk ─────────────────────────────────────────────────────────
class TerrainChunk {
  private scene: Scene
  private mesh: Mesh | null = null
  private material: StandardMaterial
  private density: Float32Array

  readonly cx: number
  readonly cz: number
  readonly originX: number
  readonly originY: number
  readonly originZ: number

  constructor(
    scene: Scene,
    material: StandardMaterial,
    cx: number, cz: number,
    originX: number, originY: number, originZ: number,
  ) {
    this.scene = scene
    this.material = material
    this.cx = cx
    this.cz = cz
    this.originX = originX
    this.originY = originY
    this.originZ = originZ

    const total = CHUNK_SAMPLES * VERT_SAMPLES * CHUNK_SAMPLES
    this.density = new Float32Array(total)

    // Initialise density: solid below surface, air above
    this.initDensity()
    this.rebuild()
  }

  private initDensity(): void {
    for (let z = 0; z < CHUNK_SAMPLES; z++) {
      for (let y = 0; y < VERT_SAMPLES; y++) {
        for (let x = 0; x < CHUNK_SAMPLES; x++) {
          const worldY = this.originY + y * CELL_SIZE

          // Base terrain: everything below y=0 is solid, above is air
          // Density decreases as we go up, giving a smooth surface
          let d = -worldY

          // Add gentle rolling hills using sin waves
          const worldX = this.originX + x * CELL_SIZE
          const worldZ = this.originZ + z * CELL_SIZE
          d += Math.sin(worldX * 0.05) * Math.cos(worldZ * 0.07) * 1.5
          d += Math.sin(worldX * 0.12 + worldZ * 0.08) * 0.8

          this.density[this.idx(x, y, z)] = d
        }
      }
    }
  }

  private idx(x: number, y: number, z: number): number {
    return x + y * CHUNK_SAMPLES + z * CHUNK_SAMPLES * VERT_SAMPLES
  }

  /** Check if a sphere in world space overlaps this chunk's AABB */
  intersectsSphere(wx: number, wy: number, wz: number, r: number): boolean {
    const maxX = this.originX + CHUNK_SIZE
    const maxY = this.originY + VERT_SAMPLES * CELL_SIZE
    const maxZ = this.originZ + CHUNK_SIZE

    const closestX = Math.max(this.originX, Math.min(wx, maxX))
    const closestY = Math.max(this.originY, Math.min(wy, maxY))
    const closestZ = Math.max(this.originZ, Math.min(wz, maxZ))

    const dx = wx - closestX
    const dy = wy - closestY
    const dz = wz - closestZ
    return dx * dx + dy * dy + dz * dz <= r * r
  }

  /** Subtract a sphere from the density field */
  subtractSphere(wx: number, wy: number, wz: number, r: number, strength: number): void {
    // Convert to local grid coords
    const gxMin = Math.max(0, Math.floor((wx - r - this.originX) / CELL_SIZE) - 1)
    const gxMax = Math.min(CHUNK_SAMPLES - 1, Math.ceil((wx + r - this.originX) / CELL_SIZE) + 1)
    const gyMin = Math.max(0, Math.floor((wy - r - this.originY) / CELL_SIZE) - 1)
    const gyMax = Math.min(VERT_SAMPLES - 1, Math.ceil((wy + r - this.originY) / CELL_SIZE) + 1)
    const gzMin = Math.max(0, Math.floor((wz - r - this.originZ) / CELL_SIZE) - 1)
    const gzMax = Math.min(CHUNK_SAMPLES - 1, Math.ceil((wz + r - this.originZ) / CELL_SIZE) + 1)

    for (let z = gzMin; z <= gzMax; z++) {
      for (let y = gyMin; y <= gyMax; y++) {
        for (let x = gxMin; x <= gxMax; x++) {
          const px = this.originX + x * CELL_SIZE
          const py = this.originY + y * CELL_SIZE
          const pz = this.originZ + z * CELL_SIZE

          const dx = px - wx
          const dy = py - wy
          const dz = pz - wz
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

          if (dist < r) {
            // Smooth falloff: strongest at centre, fades to edge
            const falloff = 1 - (dist / r)
            const amount = strength * falloff * falloff // quadratic falloff
            const i = this.idx(x, y, z)
            this.density[i] -= amount
          }
        }
      }
    }
  }

  /** Get the density value at a world position */
  getDensityAt(wx: number, wy: number, wz: number): number {
    const gx = (wx - this.originX) / CELL_SIZE
    const gy = (wy - this.originY) / CELL_SIZE
    const gz = (wz - this.originZ) / CELL_SIZE

    const x = Math.round(gx)
    const y = Math.round(gy)
    const z = Math.round(gz)

    if (x < 0 || x >= CHUNK_SAMPLES || y < 0 || y >= VERT_SAMPLES || z < 0 || z >= CHUNK_SAMPLES) {
      return wy < 0 ? 1 : -1
    }
    return this.density[this.idx(x, y, z)]
  }

  /** Find the surface Y at a given world (x, z) by scanning down the density column */
  getSurfaceY(wx: number, wz: number): number {
    const gx = Math.round((wx - this.originX) / CELL_SIZE)
    const gz = Math.round((wz - this.originZ) / CELL_SIZE)

    if (gx < 0 || gx >= CHUNK_SAMPLES || gz < 0 || gz >= CHUNK_SAMPLES) return 0

    // Scan from top to bottom, find the first solid cell
    for (let y = VERT_SAMPLES - 1; y >= 0; y--) {
      if (this.density[this.idx(gx, y, gz)] > 0) {
        return this.originY + y * CELL_SIZE
      }
    }
    return this.originY
  }

  /** Rebuild the mesh from current density data */
  rebuild(): void {
    const result = marchingCubes(
      this.density,
      CHUNK_SAMPLES, VERT_SAMPLES, CHUNK_SAMPLES,
      CELL_SIZE,
      this.originX, this.originY, this.originZ,
    )

    if (result.positions.length === 0) {
      if (this.mesh) {
        this.mesh.dispose()
        this.mesh = null
      }
      return
    }

    if (!this.mesh) {
      this.mesh = new Mesh(`chunk_${this.cx}_${this.cz}`, this.scene)
      this.mesh.material = this.material
    }

    // Vertex colours: upward-facing faces → grass green; sides/underground → dirt brown
    const vertCount = result.positions.length / 3
    const colors = new Float32Array(vertCount * 4)
    for (let i = 0; i < vertCount; i++) {
      const ny = result.normals[i * 3 + 1]
      if (ny > 0.5) {
        // grass
        colors[i * 4 + 0] = 0.28
        colors[i * 4 + 1] = 0.60
        colors[i * 4 + 2] = 0.14
        colors[i * 4 + 3] = 1.0
      } else {
        // dirt
        colors[i * 4 + 0] = 0.52
        colors[i * 4 + 1] = 0.37
        colors[i * 4 + 2] = 0.22
        colors[i * 4 + 3] = 1.0
      }
    }

    const vertexData = new VertexData()
    vertexData.positions = result.positions
    vertexData.indices = result.indices
    vertexData.normals = result.normals
    vertexData.colors = colors
    vertexData.applyToMesh(this.mesh, true) // updatable = true for re-digging
  }
}
