import '@babylonjs/loaders/glTF'
import {
  Scene,
  Vector3,
  ArcRotateCamera,
  SceneLoader,
  TransformNode,
  AbstractMesh,
  AnimationGroup,
  Mesh,
} from '@babylonjs/core'
import type { Terrain } from './terrain'

// ── Movement constants ───────────────────────────────────────────────────────
const GRAVITY       = -28
const JUMP_VELOCITY = 14
const MOVE_SPEED    = 8
const PLAYER_HEIGHT = 1.2
const PLAYER_RADIUS = 0.4
const TERMINAL_VEL  = -30
const FOX_SCALE     = 1.8

const SPAWN = new Vector3(0, 4, 0)

type AnimState = 'idle' | 'run' | 'jump' | 'fall'

const FOX_ANIM_FILES: Record<AnimState, string> = {
  idle: './assets/fox/idle.glb',
  run:  './assets/fox/run.glb',
  jump: './assets/fox/jump.glb',
  fall: './assets/fox/fall.glb',
}

interface AnimEntry {
  root: TransformNode
  yOffset: number
  group: AnimationGroup | null
}

function meshBottomY(meshes: AbstractMesh[]): number {
  let minY = Infinity
  for (const m of meshes) {
    m.computeWorldMatrix(true)
    const worldMin = m.getBoundingInfo().boundingBox.minimumWorld.y
    if (worldMin < minY) minY = worldMin
  }
  return minY === Infinity ? 0 : minY
}

export class Player {
  private scene: Scene
  private terrain: Terrain

  /** feet position in world space */
  position = SPAWN.clone()
  private velocity = Vector3.Zero()
  private onGround = false

  camera!: ArcRotateCamera
  /** The direction the player model faces (radians, Y axis) */
  facingY = 0

  // Input state
  private keys = new Set<string>()

  // Model
  private modelRoot: TransformNode | null = null
  private anims = new Map<AnimState, AnimEntry>()
  private currentAnim: AnimState = 'idle'
  private animsLoaded = false

  constructor(scene: Scene, terrain: Terrain) {
    this.scene = scene
    this.terrain = terrain
    this.setupCamera()
    this.setupInput()
    this.loadModel()
  }

  // ── Camera ───────────────────────────────────────────────────────────────────
  private setupCamera(): void {
    // ArcRotateCamera orbits the player — uses LEFT mouse drag to rotate (no pointer lock needed)
    const cam = new ArcRotateCamera('cam', -Math.PI / 2, 1.0, 14, SPAWN.clone(), this.scene)
    cam.lowerRadiusLimit = 4
    cam.upperRadiusLimit = 28
    cam.lowerBetaLimit = 0.2
    cam.upperBetaLimit = Math.PI * 0.45

    // Disable panning (middle mouse) and keyboard
    cam.panningSensibility = 0
    cam.inputs.removeByType('ArcRotateCameraKeyboardMoveInput')
    // Pointer-lock handles rotation manually — remove the default drag handler
    cam.inputs.removeByType('ArcRotateCameraPointersInput')

    const canvas = this.scene.getEngine().getRenderingCanvas()!
    cam.attachControl(canvas, true)
    this.camera = cam

    // Click canvas to capture pointer; mouse movement rotates camera
    canvas.addEventListener('click', () => {
      canvas.requestPointerLock()
    })
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return
      const sens = 0.004
      cam.alpha -= e.movementX * sens
      cam.beta  += e.movementY * sens
      if (cam.beta < (cam.lowerBetaLimit ?? 0.2))            cam.beta = cam.lowerBetaLimit ?? 0.2
      if (cam.beta > (cam.upperBetaLimit ?? Math.PI * 0.45)) cam.beta = cam.upperBetaLimit ?? Math.PI * 0.45
    })
  }

  // ── Input ────────────────────────────────────────────────────────────────────
  private setupInput(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase())
    })

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase())
    })
  }

  // ── Model ────────────────────────────────────────────────────────────────────
  private async loadModel(): Promise<void> {
    // Create a common root that follows the player position
    this.modelRoot = new TransformNode('foxRoot', this.scene)

    for (const [anim, file] of Object.entries(FOX_ANIM_FILES) as [AnimState, string][]) {
      try {
        const result = await SceneLoader.ImportMeshAsync('', '', file, this.scene)
        const root = new TransformNode(`fox_${anim}`, this.scene)
        root.parent = this.modelRoot

        const meshes = result.meshes.filter((m: AbstractMesh): m is Mesh => m !== result.meshes[0])
        const bottomY = meshBottomY(meshes)

        for (const m of meshes) {
          m.parent = root
        }
        // Clean up the __root__ node
        result.meshes[0].dispose()

        root.scaling.setAll(FOX_SCALE)
        root.setEnabled(false)

        const group = result.animationGroups[0] ?? null
        if (group) {
          group.stop()
          const noLoop = anim === 'jump'
          group.loopAnimation = !noLoop
        }

        this.anims.set(anim, { root, yOffset: bottomY * FOX_SCALE, group })
      } catch (err) {
        console.warn(`Failed to load fox anim: ${anim}`, err)
      }
    }

    this.animsLoaded = true
    this.playAnim('idle')
  }

  private playAnim(a: AnimState): void {
    if (a === this.currentAnim || !this.animsLoaded) return
    const prev = this.anims.get(this.currentAnim)
    if (prev) {
      prev.root.setEnabled(false)
      prev.group?.stop()
    }
    const next = this.anims.get(a)
    if (next) {
      next.root.setEnabled(true)
      next.group?.start(next.group.loopAnimation, 1.0, next.group.from, next.group.to, false)
    }
    this.currentAnim = a
  }

  // ── Update (call each frame) ─────────────────────────────────────────────────
  update(dt: number): void {
    // ── Horizontal movement (camera-relative) ──────────────────────────────
    let moveX = 0
    let moveZ = 0
    if (this.keys.has('w') || this.keys.has('arrowup'))    moveZ += 1
    if (this.keys.has('s') || this.keys.has('arrowdown'))  moveZ -= 1
    if (this.keys.has('a') || this.keys.has('arrowleft'))  moveX -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) moveX += 1

    const camAlpha = this.camera.alpha
    // forward = direction FROM camera position TO player (i.e. camera-facing direction)
    const forward = new Vector3(-Math.sin(camAlpha), 0, -Math.cos(camAlpha))
    const right   = new Vector3(Math.cos(camAlpha), 0, -Math.sin(camAlpha))
    const moveDir = forward.scale(moveZ).add(right.scale(moveX))
    if (moveDir.length() > 0.01) {
      moveDir.normalize()
      this.facingY = Math.atan2(moveDir.x, moveDir.z)
    }

    const speed = MOVE_SPEED
    this.velocity.x = moveDir.x * speed
    this.velocity.z = moveDir.z * speed

    // ── Jump ───────────────────────────────────────────────────────────────
    if ((this.keys.has(' ') || this.keys.has('e')) && this.onGround) {
      this.velocity.y = JUMP_VELOCITY
      this.onGround = false
    }

    // ── Gravity ────────────────────────────────────────────────────────────
    this.velocity.y += GRAVITY * dt
    if (this.velocity.y < TERMINAL_VEL) this.velocity.y = TERMINAL_VEL

    // ── Move position ──────────────────────────────────────────────────────
    this.position.x += this.velocity.x * dt
    this.position.y += this.velocity.y * dt
    this.position.z += this.velocity.z * dt

    // ── Terrain collision ──────────────────────────────────────────────────
    this.onGround = false

    // Check terrain surface below feet
    const surfaceY = this.terrain.getSurfaceY(this.position.x, this.position.z)

    if (this.position.y <= surfaceY + 0.05) {
      // Check if position is actually inside solid terrain
      // If we're moving downward and hit the surface, land on it
      if (this.velocity.y <= 0) {
        this.position.y = surfaceY + 0.05
        this.velocity.y = 0
        this.onGround = true
      }
    }

    // Additional: check if we're inside solid terrain (for tunnel walls)
    // Push player out of terrain if they clip through
    if (this.terrain.isSolid(this.position.x, this.position.y + PLAYER_HEIGHT * 0.5, this.position.z)) {
      // Being inside solid, push upward
      this.position.y += 0.3
    }

    // World floor (bottom of terrain grid)
    if (this.position.y < -12) {
      this.position.copyFrom(SPAWN)
      this.velocity.setAll(0)
    }

    // ── Animation state ────────────────────────────────────────────────────
    const moving = Math.abs(moveDir.x) > 0.1 || Math.abs(moveDir.z) > 0.1
    if (!this.onGround) {
      this.playAnim(this.velocity.y > 0 ? 'jump' : 'fall')
    } else if (moving) {
      this.playAnim('run')
    } else {
      this.playAnim('idle')
    }

    // ── Sync model to position ─────────────────────────────────────────────
    if (this.modelRoot) {
      this.modelRoot.position.copyFrom(this.position)
      this.modelRoot.rotation.y = this.facingY
    }

    // ── Camera target follows player ───────────────────────────────────────
    const headY = this.position.y + PLAYER_HEIGHT * 0.8
    this.camera.target.set(this.position.x, headY, this.position.z)
  }

  /** Get current position (for external use) */
  getPosition(): Vector3 {
    return this.position.clone()
  }
}
