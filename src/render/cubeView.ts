import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { NORMAL, STICKERS, type Face } from '../cube/geometry'

const EMPTY = '#000000'
/** camera distance that keeps the whole cube in frame at the default field of view */
const DISTANCE = 12.5

/** A 3D cube you can orbit. Callers hand it one colour per facelet (null = not scanned yet). */
export class CubeView {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
  private readonly controls: OrbitControls
  private readonly stickers: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly highlight: THREE.Mesh
  private readonly markers: THREE.Mesh[] = []
  private flyTo: THREE.Vector3 | null = null
  private onPick: ((index: number) => void) | null = null
  private raf = 0

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    host.appendChild(this.renderer.domElement)

    this.camera.position.set(DISTANCE * 0.5, DISTANCE * 0.45, DISTANCE * 0.74)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enablePan = false
    this.controls.enableDamping = true
    this.controls.minDistance = 8
    this.controls.maxDistance = 20

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(4, 8, 6)
    this.scene.add(sun)

    const bodyGeo = new RoundedBoxGeometry(0.97, 0.97, 0.97, 3, 0.09)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.55 })
    const stickerGeo = new THREE.PlaneGeometry(0.84, 0.84)
    const cubies = new Map<string, THREE.Group>()

    for (const s of STICKERS) {
      const k = s.pos.join(',')
      let cubie = cubies.get(k)
      if (!cubie) {
        cubie = new THREE.Group()
        cubie.position.set(...s.pos)
        cubie.add(new THREE.Mesh(bodyGeo, bodyMat))
        this.scene.add(cubie)
        cubies.set(k, cubie)
      }
      const mesh = new THREE.Mesh(stickerGeo, new THREE.MeshBasicMaterial({ color: EMPTY }))
      const n = new THREE.Vector3(...s.normal)
      mesh.position.copy(n.clone().multiplyScalar(0.489))
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
      mesh.userData.index = s.index
      cubie.add(mesh)
      this.stickers[s.index] = mesh

      // a small ring that can be switched on to say "check this sticker"
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.19, 24),
        new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }),
      )
      marker.position.z = 0.003
      marker.visible = false
      mesh.add(marker)
      this.markers[s.index] = marker
    }

    // outline shown around the face being scanned
    this.highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(3.02, 3.02),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.2, depthWrite: false }),
    )
    this.highlight.visible = false
    this.scene.add(this.highlight)

    this.setupPicking()
    new ResizeObserver(() => this.resize()).observe(host)
    this.resize()
    this.loop()
  }

  setColors(colors: (string | null)[]): void {
    colors.forEach((c, i) => this.stickers[i].material.color.set(c ?? EMPTY))
  }

  /** Ring the stickers the scanner wasn't sure about. */
  setMarked(indices: Iterable<number>): void {
    this.markers.forEach((m) => (m.visible = false))
    for (const i of indices) this.markers[i].visible = true
  }

  /** Swing the camera round to look straight at a face, and tint that face. */
  focusFace(face: Face | null): void {
    if (!face) {
      this.highlight.visible = false
      return
    }
    const n = new THREE.Vector3(...NORMAL[face])
    this.highlight.visible = true
    this.highlight.position.copy(n.clone().multiplyScalar(1.53))
    this.highlight.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
    // look at the face from slightly off-axis so the cube still reads as 3D
    const off =
      n.y !== 0
        ? new THREE.Vector3(0, 0, 2.4)
        : new THREE.Vector3(0, 2.4, 0).add(new THREE.Vector3(-n.z, 0, n.x).multiplyScalar(1.8))
    this.flyTo = n.multiplyScalar(7).add(off).setLength(DISTANCE)
  }

  /** Click/tap a sticker (centres excluded). */
  onStickerPick(cb: ((index: number) => void) | null): void {
    this.onPick = cb
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private setupPicking(): void {
    const ray = new THREE.Raycaster()
    const el = this.renderer.domElement
    let down: { x: number; y: number } | null = null
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }))
    el.addEventListener('pointerup', (e) => {
      if (!down || !this.onPick) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 5) return // it was an orbit drag
      const r = el.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera)
      const hit = ray.intersectObjects(this.stickers)[0]
      if (hit) this.onPick(hit.object.userData.index as number)
    })
  }

  private resize(): void {
    const w = this.host.clientWidth || 300
    const h = this.host.clientHeight || 300
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    if (this.flyTo) {
      this.camera.position.lerp(this.flyTo, 0.12)
      if (this.camera.position.distanceTo(this.flyTo) < 0.02) this.flyTo = null
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}
