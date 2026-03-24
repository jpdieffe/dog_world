import {
  Engine,
  Scene,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  Color4,
  Color3,
  Ray,
  MeshBuilder,
  StandardMaterial,
} from '@babylonjs/core'
import { Terrain } from './terrain'
import { Player } from './player'

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement

// ── On-screen status/error overlay ───────────────────────────────────────────
function showStatus(msg: string, isError = false): void {
  let el = document.getElementById('_gameStatus')
  if (!el) {
    el = document.createElement('div')
    el.id = '_gameStatus'
    el.style.cssText = [
      'position:fixed', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'background:rgba(0,10,40,0.93)',
      'padding:1.2rem 2rem',
      'font:0.95rem/1.5 system-ui,sans-serif',
      'z-index:999', 'border-radius:10px',
      'max-width:80%', 'text-align:center',
      'white-space:pre-wrap', 'border:1px solid #446',
    ].join(';')
    document.body.appendChild(el)
  }
  el.style.color = isError ? '#f88' : '#cdf'
  el.textContent = msg
}
function hideStatus(): void {
  document.getElementById('_gameStatus')?.remove()
}

async function startGame() {
  showStatus('Starting engine…')

  canvas.width  = canvas.clientWidth  || window.innerWidth
  canvas.height = canvas.clientHeight || window.innerHeight

  // Try WebGL2, fall back to WebGL1
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
    showStatus(
      'WebGL failed to start.\n\nTry:\n• Enable hardware acceleration in browser settings\n• Update graphics drivers\n• Try a different browser',
      true,
    )
    return
  }

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.55, 0.78, 0.96, 1.0)

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemi.intensity = 0.6
  const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1), scene)
  sun.intensity = 0.9
  sun.position = new Vector3(30, 60, 30)

  // ── Debug reference object — orange sphere at origin ─────────────────────
  // (Lets us verify Babylon is rendering even if terrain fails)
  const debugSphere = MeshBuilder.CreateSphere('debugSphere', { diameter: 2 }, scene)
  debugSphere.position.set(0, 1, 0)
  const debugMat = new StandardMaterial('debugMat', scene)
  debugMat.diffuseColor = new Color3(1, 0.5, 0)
  debugSphere.material = debugMat

  // ── Terrain ───────────────────────────────────────────────────────────────
  showStatus('Building terrain…')
  let terrain: Terrain | null = null
  try {
    terrain = new Terrain(scene)
    debugSphere.dispose() // hide debug sphere once terrain is ready
    console.log('Terrain created OK')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    showStatus(`Terrain error:\n${msg}\n\nYou can still see the orange sphere if rendering works.`, true)
    console.error('Terrain error:', err)
  }

  // ── Player ────────────────────────────────────────────────────────────────
  let player: Player | null = null
  if (terrain) {
    try {
      player = new Player(scene, terrain)
      hideStatus()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showStatus(`Player error:\n${msg}`, true)
      console.error('Player error:', err)
    }
  } else {
    hideStatus()
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  let digging = false
  canvas.addEventListener('mousedown', (e) => { if (e.button === 2) digging = true })
  canvas.addEventListener('mouseup',   (e) => { if (e.button === 2) digging = false })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  let digCooldown = 0
  const DIG_INTERVAL = 0.15

  // ── Render loop ───────────────────────────────────────────────────────────
  engine.runRenderLoop(() => {
    try {
      const dt = Math.min(engine!.getDeltaTime() / 1000, 0.05)

      if (player) {
        player.update(dt)

        if (digging && terrain) {
          digCooldown -= dt
          if (digCooldown <= 0) {
            digCooldown = DIG_INTERVAL
            const cam = player.camera
            const dir = cam.target.subtract(cam.position).normalize()
            const ray = new Ray(cam.position, dir, 20)
            const hit = scene.pickWithRay(ray, (m: any) => m.name.startsWith('chunk_'))
            if (hit?.hit && hit.pickedPoint) {
              const pt = hit.pickedPoint
              const normal = hit.getNormal(true)
              if (normal) pt.addInPlace(normal.scale(-0.3))
              terrain!.dig(pt.x, pt.y, pt.z)
            }
          }
        } else {
          digCooldown = 0
        }
      }
    } catch (err) {
      console.error('Render loop error:', err)
    }

    scene.render()
  })

  window.addEventListener('resize', () => engine!.resize())
}

startGame().catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  showStatus(`Startup failed:\n${msg}`, true)
  console.error('startGame failed:', err)
})
