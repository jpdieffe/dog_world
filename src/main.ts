import {
  Engine,
  Scene,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  Color4,
  Ray,
} from '@babylonjs/core'
import { Terrain } from './terrain'
import { Player } from './player'

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement

async function startGame() {
  let engine: Engine | undefined
  for (const noWebGL2 of [false, true]) {
    try {
      engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        disableWebGL2Support: noWebGL2,
      })
      break
    } catch { /* try next */ }
  }
  if (!engine) {
    document.body.innerHTML = '<p style="color:#fff;padding:2rem">WebGL failed to start.</p>'
    return
  }

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.55, 0.78, 0.96, 1.0) // sky blue

  // ── Lighting ──────────────────────────────────────────────────────────────
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemi.intensity = 0.6

  const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1), scene)
  sun.intensity = 0.9
  sun.position = new Vector3(30, 60, 30)

  // ── Terrain ───────────────────────────────────────────────────────────────
  const terrain = new Terrain(scene)

  // ── Player ────────────────────────────────────────────────────────────────
  const player = new Player(scene, terrain)

  // ── Dig on click ──────────────────────────────────────────────────────────
  let digging = false
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) digging = true
  })
  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0) digging = false
  })

  // Dig timer: allow continuous digging while holding the button
  let digCooldown = 0
  const DIG_INTERVAL = 0.15  // seconds between digs while holding

  // ── Render loop ───────────────────────────────────────────────────────────
  engine.runRenderLoop(() => {
    const dt = Math.min(engine!.getDeltaTime() / 1000, 0.05)

    player.update(dt)

    // Handle digging
    if (digging) {
      digCooldown -= dt
      if (digCooldown <= 0) {
        digCooldown = DIG_INTERVAL

        // Cast ray from camera through screen center to find dig point
        const cam = player.camera
        const dir = cam.target.subtract(cam.position).normalize()
        const ray = new Ray(cam.position, dir, 20)
        const hit = scene.pickWithRay(ray, (mesh: any) => mesh.name.startsWith('chunk_'))

        if (hit?.hit && hit.pickedPoint) {
          // Dig at the hit point, slightly inward
          const pt = hit.pickedPoint
          const normal = hit.getNormal(true)
          if (normal) {
            // Push dig centre slightly into the surface for better tunnel feel
            pt.addInPlace(normal.scale(-0.3))
          }
          terrain.dig(pt.x, pt.y, pt.z)
        }
      }
    } else {
      digCooldown = 0
    }

    scene.render()
  })

  // Handle window resize
  window.addEventListener('resize', () => engine!.resize())

  // ── Pointer lock on click ─────────────────────────────────────────────────
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock()
    }
  })
}

startGame()
