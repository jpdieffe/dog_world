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
  // Ensure canvas has actual pixel dimensions before creating the engine
  canvas.width = canvas.clientWidth || window.innerWidth
  canvas.height = canvas.clientHeight || window.innerHeight

  const engine = new Engine(canvas, true)

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.55, 0.78, 0.96, 1.0) // sky blue

  // ── Lighting ──────────────────────────────────────────────────────────────
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemi.intensity = 0.6

  const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1), scene)
  sun.intensity = 0.9
  sun.position = new Vector3(30, 60, 30)

  // ── Terrain ───────────────────────────────────────────────────────────────
  console.log('Creating terrain...')
  const terrain = new Terrain(scene)
  console.log('Terrain created.')

  // ── Player ────────────────────────────────────────────────────────────────
  const player = new Player(scene, terrain)

  // ── Dig on click (right-click so left-click is for camera rotation) ───────
  let digging = false
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) digging = true   // right click to dig
  })
  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 2) digging = false
  })
  // Prevent context menu on right-click
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  // Dig timer: allow continuous digging while holding the button
  let digCooldown = 0
  const DIG_INTERVAL = 0.15  // seconds between digs while holding

  // ── Render loop ───────────────────────────────────────────────────────────
  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05)

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
  window.addEventListener('resize', () => engine.resize())
}

startGame().catch(err => console.error('Game failed to start:', err))
