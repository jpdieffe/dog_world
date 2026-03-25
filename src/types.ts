/** Animation states for the fox player */
export type AnimState = 'idle' | 'run' | 'jump' | 'fall'

/** Player state synced over the network */
export interface PlayerState {
  x: number
  y: number
  z: number
  ry: number
  anim: AnimState
}

/** Dig event synced over the network */
export interface DigEvent {
  x: number
  y: number
  z: number
}

/** Network message envelope */
export type NetMessage =
  | { type: 'state'; state: PlayerState }
  | { type: 'dig'; dig: DigEvent }
