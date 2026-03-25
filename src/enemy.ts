import '@babylonjs/loaders/glTF'
import {
  Scene,
  Vector3,
  SceneLoader,
  TransformNode,
  AbstractMesh,
  AnimationGroup,
  Mesh,
} from '@babylonjs/core'
import type { Terrain } from './terrain'

const HUMAN_FILE   = './assets/human/human_comprehensive.glb'
const HUMAN_SCALE  = 6.4
const DETECT_RANGE = 18
const CHASE_SPEED  = 7
const PATROL_SPEED = 2
const CATCH_DIST   = 2.0

type EnemyAnim = 'idle' | 'walk' | 'run'

function meshBottomY(meshes: AbstractMesh[]): number {
  let minY = Infinity
  for (const m of meshes) {
    m.computeWorldMatrix(true)
    const worldMin = m.getBoundingInfo().boundingBox.minimumWorld.y
    if (worldMin < minY) minY = worldMin
  }
  return minY === Infinity ? 0 : minY
}

export class Enemy {
  readonly position = new Vector3()
  private spawnPos = new Vector3()
  private root: TransformNode | null = null
  private yOffset = 0
  private facingY = 0
  private chasing = false
  private animGroups = new Map<string, AnimationGroup>()
  private currentAnimName = ''
  private patrolAngle = 0
  private loaded = false

  constructor(
    private scene: Scene,
    private terrain: Terrain,
    x: number, z: number,
  ) {
    const surfY = terrain.getSurfaceY(x, z)
    this.position.set(x, surfY + 0.1, z)
    this.spawnPos.copyFrom(this.position)
    this.patrolAngle = Math.random() * Math.PI * 2
    this.load()
  }

  private async load() {
    try {
      const result = await SceneLoader.ImportMeshAsync('', '', HUMAN_FILE, this.scene)
      this.root = new TransformNode('enemy_root', this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = this.root! })
      this.root.scaling.setAll(HUMAN_SCALE)
      this.root.position.copyFrom(this.position)

      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))
      this.yOffset = -meshBottomY(result.meshes)

      // Catalogue animation groups by name
      for (const ag of result.animationGroups) {
        const name = ag.name.toLowerCase()
        this.animGroups.set(name, ag)
        ag.stop()
      }

      this.playAnim('idle')
      this.loaded = true
    } catch (err) {
      console.warn('[Enemy] Failed to load human model', err)
    }
  }

  private playAnim(name: string) {
    if (name === this.currentAnimName) return
    // Stop previous
    const prev = this.animGroups.get(this.currentAnimName)
    if (prev) prev.stop()

    // Try exact name, then common fallbacks
    let ag = this.animGroups.get(name)
    if (!ag) {
      // Try finding a group whose name contains the target
      for (const [key, group] of this.animGroups) {
        if (key.includes(name)) { ag = group; break }
      }
    }
    if (ag) {
      ag.start(true)
      this.currentAnimName = name
    }
  }

  /** Returns true if the enemy caught the player */
  update(dt: number, playerPos: Vector3, remotePos: Vector3 | null): boolean {
    if (!this.loaded) return false

    // Determine closest player
    let targetPos = playerPos
    if (remotePos) {
      const dLocal  = Vector3.Distance(this.position, playerPos)
      const dRemote = Vector3.Distance(this.position, remotePos)
      if (dRemote < dLocal) targetPos = remotePos
    }

    const dx = targetPos.x - this.position.x
    const dz = targetPos.z - this.position.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < DETECT_RANGE) {
      // Chase
      this.chasing = true
      const angle = Math.atan2(dx, dz)
      this.facingY = angle
      const speed = CHASE_SPEED * dt
      this.position.x += Math.sin(angle) * speed
      this.position.z += Math.cos(angle) * speed
      this.playAnim('run')
    } else {
      // Patrol — wander in a small circle around spawn
      this.chasing = false
      this.patrolAngle += dt * 0.5
      const px = this.spawnPos.x + Math.sin(this.patrolAngle) * 4
      const pz = this.spawnPos.z + Math.cos(this.patrolAngle) * 4
      const pdx = px - this.position.x
      const pdz = pz - this.position.z
      const pDist = Math.sqrt(pdx * pdx + pdz * pdz)
      if (pDist > 0.5) {
        this.facingY = Math.atan2(pdx, pdz)
        const speed = Math.min(PATROL_SPEED * dt, pDist)
        this.position.x += (pdx / pDist) * speed
        this.position.z += (pdz / pDist) * speed
        this.playAnim('walk')
      } else {
        this.playAnim('idle')
      }
    }

    // Ground snap
    const surfY = this.terrain.getSurfaceY(this.position.x, this.position.z)
    this.position.y = surfY + 0.1

    // Sync model
    if (this.root) {
      this.root.position.set(this.position.x, this.position.y + this.yOffset, this.position.z)
      this.root.rotation.y = this.facingY
    }

    // Catch check against local player only
    const catchDx = playerPos.x - this.position.x
    const catchDz = playerPos.z - this.position.z
    const catchDist = Math.sqrt(catchDx * catchDx + catchDz * catchDz)
    return catchDist < CATCH_DIST && this.chasing
  }

  dispose() {
    if (this.root) {
      for (const ag of this.animGroups.values()) ag.stop()
      this.root.getChildMeshes(true).forEach(m => m.dispose())
      this.root.dispose()
      this.root = null
    }
  }
}
