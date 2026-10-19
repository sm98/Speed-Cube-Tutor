import { applyMoves, solvedCube, type Cube } from '../cube/cube'
import { FACES, type Face } from '../cube/geometry'
import { validateCube } from '../cube/validate'
import { CubeView } from '../render/cubeView'
import { colorHex, estimateGains, labDist, labFrom, nearestName, NO_GAINS, type ColorName, type Gains, type Lab } from '../scan/color'
import type { Box } from '../scan/cuboid'
import { ScanSession, STANDARD_SCHEME, StabilityGate } from '../scan/session'
import { CubeTracker, type CubeReading } from '../scan/tracker'
import { defaultFaces, sampleQuad } from '../scan/cubefit'

const DEFAULT_SCHEME: Record<Face, ColorName> = STANDARD_SCHEME
const FRAME_MS = 66

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
    <header>
      <h1>Cube Tutor</h1>
      <p>Point a corner of the cube at the camera and take a photo. A 3D box locks on and reads all three visible faces at once; two opposite corners cover the whole cube.</p>
    </header>
    <main>
      <section class="panel">
        <h2>1 · Scan</h2>
        <div class="stage">
          <canvas id="cam"></canvas>
          <div class="placeholder" id="placeholder">Start the camera, or upload a photo of each face.</div>
        </div>
        <div class="prompt"><strong id="title"></strong><span id="hint"></span></div>
        <div id="msg"></div>
        <div class="thumbs" id="thumbs"></div>
        <div class="actions" id="scan-actions">
          <button class="btn primary normal" id="start">Start camera</button>
          <button class="btn primary normal" id="photo" disabled>Take photo</button>
          <button class="btn normal" id="upload">Upload photo</button>
          <button class="btn normal" id="reset">Start over</button>
          <label class="check normal"><input type="checkbox" id="auto" /> Auto-capture while turning</label>
          <button class="btn primary adjust-only" id="accept">Accept these faces</button>
          <button class="btn adjust-only" id="cancel">Cancel</button>
          <input type="file" id="file" accept="image/*" hidden />
        </div>
      </section>
      <section class="panel">
        <h2>2 · Your cube</h2>
        <div id="view"></div>
        <div class="status" id="status"></div>
        <div class="palette" id="palette" hidden></div>
        <div class="actions">
          <button class="btn" id="demo">Try a sample scramble</button>
          <button class="btn" id="paint">Enter colours by hand</button>
        </div>
      </section>
    </main>`

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!
  const cam = $<HTMLCanvasElement>('cam')
  const ctx = cam.getContext('2d', { willReadFrequently: true })!
  const view = new CubeView($('view'))
  const session = new ScanSession()
  const tracker = new CubeTracker()
  /** one steadiness check per face in view (told apart by centre colour), since several are visible at once */
  let gates: { ref: Lab; gate: StabilityGate }[] = []
  const gateFor = (labs: Lab[]): StabilityGate => {
    let g = gates.find((x) => labDist(x.ref, labs[4]) < 12)
    if (!g) gates.push((g = { ref: labs[4], gate: new StabilityGate() }))
    g.ref = labs[4]
    return g.gate
  }
  const video = document.createElement('video')
  video.playsInline = true
  video.muted = true

  let mode: 'scan' | 'review' = 'scan'
  let stream: MediaStream | null = null
  let raf = 0
  let lastFrame = 0
  let lastReading: CubeReading | null = null
  /** clean, not-yet-captured faces in view right now, by the face their centre colour says they are */
  const live = new Map<Face, Lab[]>()
  /** captured slots whose face is in view right now, for highlighting the thumbnails */
  let inView = new Set<number>()
  let uncertain = new Set<number>()
  let cube: Cube = solvedCube()
  let scheme = DEFAULT_SCHEME
  let paintFace: Face = 'U'

  // ---------- thumbnails of captured faces (six slots, filled in the order faces are captured)
  const thumbs = $('thumbs')
  thumbs.innerHTML = Array.from(
    { length: 6 },
    (_, i) => `<button class="thumb" data-slot="${i}" title="Rescan this face"><div class="mini">${'<i></i>'.repeat(9)}</div><span>face ${i + 1}</span></button>`,
  ).join('')
  thumbs.addEventListener('click', (e) => {
    const slot = Number((e.target as HTMLElement).closest<HTMLElement>('.thumb')?.dataset.slot)
    if (Number.isNaN(slot) || !session.captures[slot]) return
    session.retake(slot)
    enterScan()
  })

  function renderThumbs(): void {
    for (const btn of thumbs.querySelectorAll<HTMLButtonElement>('.thumb')) {
      const slot = Number(btn.dataset.slot)
      const labs = session.captures[slot]
      btn.classList.toggle('active', mode === 'scan' && inView.has(slot))
      btn.disabled = !labs
      btn.querySelector('span')!.textContent = labs ? `${nearestName(labs[4]).name} centre` : `face ${slot + 1}`
      btn.querySelectorAll('i').forEach((cell, i) => {
        cell.style.background = labs ? colorHex(nearestName(labs[i]).name) : ''
      })
    }
  }

  // ---------- 3D view colours
  function scanColors(): (string | null)[] {
    const out: (string | null)[] = new Array(54).fill(null)
    // Until all six are in, place each face by a best guess from its centre colour (the exact assignment
    // comes from the hue order of all six centres at the end).
    for (const labs of session.captures) {
      const face = session.provisionalFace(labs)
      labs.forEach((l, i) => (out[FACES.indexOf(face) * 9 + i] = colorHex(nearestName(l).name)))
    }
    if (mode === 'scan' && stream) {
      for (const [face, labs] of live) {
        labs.forEach((l, i) => (out[FACES.indexOf(face) * 9 + i] = colorHex(nearestName(l).name)))
      }
    }
    return out
  }
  const cubeColors = () => cube.map((f) => colorHex(scheme[f]))

  function refresh(): void {
    view.setColors(mode === 'scan' ? scanColors() : cubeColors())
    view.setMarked(mode === 'review' ? uncertain : [])
    renderThumbs()
    if (mode === 'scan') {
      $('title').textContent = `${session.captures.length} of 6 faces scanned`
      $('hint').textContent =
        'Show a corner of the cube and press Take photo. You can drag the grid corners to fix anything it got wrong, then Accept. Do the opposite corner next.'
      $('status').className = 'status'
      $('status').innerHTML = `<span class="hint">${session.captures.length} of 6 faces captured. Orbit the 3D cube by dragging.</span>`
      $('palette').hidden = true
    } else {
      $('title').textContent = 'Check the colours'
      $('hint').textContent = uncertain.size
        ? `Ringed stickers (${uncertain.size}) are ones I wasn\u2019t sure about. Tap any sticker to repaint it with the selected colour.`
        : 'Tap a sticker on the 3D cube to repaint it with the selected colour. Centres are fixed.'
      renderReview()
    }
  }

  function renderReview(): void {
    const { valid, issues } = validateCube(cube)
    const status = $('status')
    status.className = 'status' + (valid ? ' ok' : '')
    status.innerHTML = valid
      ? 'Looks like a valid cube ✓'
      : `This doesn’t look like a real cube yet:<ul>${issues.map((i) => `<li>${i}</li>`).join('')}</ul>`
    const pal = $('palette')
    pal.hidden = false
    pal.innerHTML =
      '<span class="label">Paint with</span>' +
      FACES.map(
        (f) => `<button class="swatch ${f === paintFace ? 'sel' : ''}" data-face="${f}" style="background:${colorHex(scheme[f])}" title="${scheme[f]}"></button>`,
      ).join('')
  }

  $('palette').addEventListener('click', (e) => {
    const f = (e.target as HTMLElement).closest<HTMLElement>('.swatch')?.dataset.face as Face | undefined
    if (f) {
      paintFace = f
      renderReview()
    }
  })
  view.onStickerPick((i) => {
    if (mode !== 'review' || i % 9 === 4) return
    cube = cube.slice()
    cube[i] = paintFace
    uncertain.delete(i)
    refresh()
  })

  // ---------- modes
  function setMsg(text: string, bad = false): void {
    const el = $('msg')
    el.textContent = text
    el.classList.toggle('bad', bad)
  }

  function enterScan(): void {
    mode = 'scan'
    live.clear()
    inView = new Set()
    view.focusFace(null)
    refresh()
    if (!stream) setMsg('Start the camera, or upload a photo of a face.')
  }

  function enterReview(): void {
    mode = 'review'
    stopCamera()
    view.focusFace(null)
    setMsg('')
    refresh()
  }

  function finishScan(): void {
    const result = session.result()
    cube = result.cube
    scheme = result.scheme
    uncertain = new Set(result.uncertain)
    enterReview()
    const turned = FACES.filter((f) => result.oriented.turns[f] !== 0).map((f) => STANDARD_SCHEME[f])
    if (turned.length && result.oriented.valid) setMsg(`I straightened the ${turned.join(', ')} face${turned.length > 1 ? 's' : ''} (held turned).`)
    if (result.warnings.length) setMsg(result.warnings.join(' '), true)
  }

  function useCube(c: Cube): void {
    session.reset()
    gates = []
    tracker.reset()
    cube = c
    scheme = DEFAULT_SCHEME
    uncertain = new Set()
    enterReview()
  }

  // ---------- capture
  function capture(labs: Lab[]): boolean {
    const checked = session.check(labs)
    if (!checked.ok) {
      setMsg(checked.reason, true)
      return false
    }
    session.capture(labs)
    gateFor(labs).markCaptured(labs)
    setMsg(`${nearestName(labs[4]).name}-centre face captured ✓`)
    if (session.complete) finishScan()
    else refresh()
    return true
  }

  // ---------- camera
  async function startCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMsg('This browser has no camera access. Use "Upload photo" instead.', true)
      return
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
    } catch (err) {
      stream = null
      setMsg(`Couldn’t open the camera (${(err as Error).name}). Allow camera access, or use "Upload photo".`, true)
      return
    }
    video.srcObject = stream
    await video.play()
    $('placeholder').hidden = true
    ;($<HTMLButtonElement>('photo')).disabled = false
    $('start').textContent = 'Stop camera'
    gates = []
    tracker.reset()
    setMsg('Hold the cube in view so the box can lock on.')
    raf = requestAnimationFrame(tick)
  }

  function stopCamera(): void {
    cancelAnimationFrame(raf)
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    lastReading = null
    live.clear()
    inView = new Set()
    video.srcObject = null
    ctx.clearRect(0, 0, cam.width, cam.height)
    $('placeholder').hidden = false
    ;($<HTMLButtonElement>('photo')).disabled = true
    $('start').textContent = 'Start camera'
  }

  function drawBox(box: Box): void {
    ctx.lineCap = 'round'
    for (const front of [false, true]) {
      ctx.strokeStyle = front ? '#22c55e' : 'rgba(255,255,255,0.8)'
      ctx.lineWidth = front ? 4 : 2
      ctx.setLineDash(front ? [] : [8, 8])
      ctx.beginPath()
      for (const e of box.edges) {
        if (e.front !== front) continue
        ctx.moveTo(e.a[0], e.a[1])
        ctx.lineTo(e.b[0], e.b[1])
      }
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  /** Outline every face and dot every sticker with the colour the scanner read there. */
  function drawFaces(reading: CubeReading, progress: Map<object, number>): void {
    for (const f of reading.faces) {
      const done = f.clean && session.matching(f.labs) >= 0
      const p = f.clean ? (progress.get(f) ?? 0) : 0
      ctx.lineWidth = 3
      ctx.strokeStyle = !f.clean ? 'rgba(239,68,68,0.9)' : done ? '#22c55e' : p > 0 ? '#3b82f6' : 'rgba(255,255,255,0.9)'
      ctx.beginPath()
      f.quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.stroke()
      if (!f.clean) continue
      f.labs.forEach((l, k) => {
        const [x, y] = f.centers[k]
        ctx.beginPath()
        ctx.arc(x, y, 8, 0, Math.PI * 2)
        ctx.fillStyle = colorHex(nearestName(l).name)
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#fff'
        ctx.stroke()
      })
    }
  }

  /** Feed every clean face through its own steadiness check; capture the ones that have held still. */
  function considerFaces(reading: CubeReading, now: number): Map<object, number> {
    const progress = new Map<object, number>()
    const ready: Lab[][] = []
    live.clear()
    inView = new Set()
    for (const f of reading.faces) {
      if (!f.clean) continue
      const slot = session.matching(f.labs)
      if (slot >= 0) {
        inView.add(slot)
        continue
      }
      if (!session.check(f.labs).ok) continue
      live.set(session.provisionalFace(f.labs), f.labs)
      const gate = gateFor(f.labs)
      const p = gate.push(f.labs, now)
      progress.set(f, p)
      if (p >= 1 && autoCapture()) ready.push(gate.reading())
    }
    for (const labs of ready) if (!session.complete) capture(labs)
    return progress
  }

  function tick(now: number): void {
    raf = requestAnimationFrame(tick)
    if (adj) return // a photo is open for adjusting: leave the picture alone
    if (now - lastFrame < FRAME_MS || video.readyState < 2 || !video.videoWidth) return
    lastFrame = now
    const W = 640
    const H = Math.round((W * video.videoHeight) / video.videoWidth)
    if (cam.width !== W || cam.height !== H) {
      cam.width = W
      cam.height = H
    }
    ctx.drawImage(video, 0, 0, W, H)
    if (mode !== 'scan' || session.complete) return

    const reading = tracker.follow(cam, now)
    lastReading = reading
    if (!reading) {
      live.clear()
      inView = new Set()
      setMsg('Hold the cube in view so the box can lock on.')
    } else {
      const progress = considerFaces(reading, now)
      if (!stream) return // that was the last face: the camera is already off
      drawBox(reading.box)
      drawFaces(reading, progress)
      const clean = reading.faces.filter((f) => f.clean).length
      const colours = [...live.values()].map((l) => nearestName(l[4]).name).join(', ')
      if (autoCapture()) setMsg(
        clean === 0
          ? 'Box is on, but the stickers aren\u2019t clear yet. Hold steady, in good light.'
          : colours
            ? `Reading ${colours}\u2026`
            : 'Those faces are already captured. Turn the cube to show new ones.',
      )
      else setMsg(clean ? `Ready: ${colours || 'faces already captured'}. Press Take photo.` : 'Box is on, but the stickers aren\u2019t clear yet. Hold steady, in good light.')
    }
    renderThumbs()
    view.setColors(scanColors())
  }

  // ---------- photos (still images: sharper, steadier, and analysed more carefully than live video)
  const autoCapture = () => $<HTMLInputElement>('auto').checked

  function takePhoto(): void {
    if (!stream || mode !== 'scan') return
    // grab the sensor's full resolution, not the small preview: more pixels per sticker
    const still = document.createElement('canvas')
    const k = Math.min(1, 1280 / video.videoWidth)
    still.width = Math.round(video.videoWidth * k)
    still.height = Math.round(video.videoHeight * k)
    still.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0, still.width, still.height)
    beginAdjust(still, tracker.still(still))
  }

  async function readPhoto(file: File): Promise<void> {
    const bmp = await createImageBitmap(file)
    const c = document.createElement('canvas')
    c.width = 960
    c.height = Math.round((960 * bmp.height) / bmp.width)
    c.getContext('2d', { willReadFrequently: true })!.drawImage(bmp, 0, 0, c.width, c.height)
    beginAdjust(c, tracker.still(c))
  }

  // ---------- adjusting a photo by hand
  type V2 = [number, number]
  interface AdjFace {
    quad: V2[]
    labs: Lab[]
    centers: V2[]
  }
  /** the photo being checked: faces are outlines (four draggable corners) whose nine cells are read live */
  let adj: { still: HTMLCanvasElement; img: ImageData; faces: AdjFace[]; gains: Gains; drag: { grabbed: { face: number; corner: number }[]; from: V2 } | null } | null = null

  function readAdjFace(quad: V2[]): AdjFace {
    const s = sampleQuad(adj!.img, quad)
    return { quad, centers: s.centers, labs: s.rgbs.map((c) => labFrom(c, adj!.gains)) }
  }

  function beginAdjust(still: HTMLCanvasElement, reading: CubeReading | null): void {
    const img = still.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, still.width, still.height)
    const quads: V2[][] = reading ? reading.faces.map((f) => f.quad) : defaultFaces(still.width, still.height)
    adj = { still, img, faces: [], gains: NO_GAINS, drag: null }
    adj.gains = estimateGains(quads.flatMap((q) => sampleQuad(img, q).rgbs), NO_GAINS)
    adj.faces = quads.map(readAdjFace)
    $('placeholder').hidden = true
    $('scan-actions').classList.add('adjusting')
    setMsg(
      reading
        ? 'Check each grid: drag a corner (white dot) until the nine dots sit on their stickers and show the right colours. Then Accept.'
        : 'I couldn\u2019t find the cube by myself. Drag the corners onto each face, then Accept.',
      !reading,
    )
    drawAdjust()
  }

  function adjustScale(): number {
    return cam.width / adj!.still.width
  }

  function drawAdjust(): void {
    if (!adj) return
    const k = adjustScale()
    cam.width = 640
    cam.height = Math.round((640 * adj.still.height) / adj.still.width)
    ctx.drawImage(adj.still, 0, 0, cam.width, cam.height)
    for (const f of adj.faces) {
      const q = f.quad.map(([x, y]) => [x * k, y * k] as V2)
      // the 3x3 grid, to see whether it follows the real sticker edges
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      for (let t = 1; t < 3; t++) {
        const lerp = (a: V2, b: V2, u: number): V2 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
        for (const [a0, a1, b0, b1] of [[q[0], q[1], q[3], q[2]], [q[0], q[3], q[1], q[2]]]) {
          const p = lerp(a0, a1, t / 3)
          const r = lerp(b0, b1, t / 3)
          ctx.beginPath()
          ctx.moveTo(p[0], p[1])
          ctx.lineTo(r[0], r[1])
          ctx.stroke()
        }
      }
      ctx.lineWidth = 3
      ctx.strokeStyle = '#3b82f6'
      ctx.beginPath()
      q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.stroke()
      f.labs.forEach((l, i) => {
        const [x, y] = [f.centers[i][0] * k, f.centers[i][1] * k]
        ctx.beginPath()
        ctx.arc(x, y, 7, 0, Math.PI * 2)
        ctx.fillStyle = colorHex(nearestName(l).name)
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#fff'
        ctx.stroke()
      })
    }
    // handles last, on top
    for (const f of adj.faces) {
      for (const [x, y] of f.quad) {
        ctx.beginPath()
        ctx.arc(x * k, y * k, 9, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()
        ctx.lineWidth = 3
        ctx.strokeStyle = '#3b82f6'
        ctx.stroke()
      }
    }
  }

  /** Mouse/touch position in the photo's own pixels, allowing for the canvas being letterboxed on screen. */
  function toPhoto(e: PointerEvent): V2 {
    const r = cam.getBoundingClientRect()
    const s = Math.min(r.width / cam.width, r.height / cam.height)
    const x = (e.clientX - r.left - (r.width - cam.width * s) / 2) / s
    const y = (e.clientY - r.top - (r.height - cam.height * s) / 2) / s
    const k = adjustScale()
    return [x / k, y / k]
  }

  cam.addEventListener('pointerdown', (e) => {
    if (!adj) return
    const [px, py] = toPhoto(e)
    const reach = 26 / adjustScale() // a generous grab radius, in photo pixels
    let best: { face: number; corner: number; d: number } | null = null
    adj.faces.forEach((f, fi) =>
      f.quad.forEach(([x, y], ci) => {
        const d = Math.hypot(x - px, y - py)
        if (d < reach && (!best || d < best.d)) best = { face: fi, corner: ci, d }
      }),
    )
    if (best) {
      const b = best as { face: number; corner: number }
      const at = adj.faces[b.face].quad[b.corner]
      // faces meet along shared edges: corners that sit together move together
      const together = 0.012 * Math.max(adj.still.width, adj.still.height) + 4
      const grabbed: { face: number; corner: number }[] = []
      adj.faces.forEach((f, fi) => f.quad.forEach(([x, y], ci) => Math.hypot(x - at[0], y - at[1]) <= together && grabbed.push({ face: fi, corner: ci })))
      adj.drag = { grabbed, from: [at[0], at[1]] }
      cam.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
  })
  cam.addEventListener('pointermove', (e) => {
    if (!adj?.drag) return
    const to = toPhoto(e)
    for (const faceIndex of new Set(adj.drag.grabbed.map((g) => g.face))) {
      const quad = adj.faces[faceIndex].quad.map((p) => [...p] as V2)
      for (const g of adj.drag.grabbed) if (g.face === faceIndex) quad[g.corner] = to
      adj.faces[faceIndex] = readAdjFace(quad)
    }
    drawAdjust()
  })
  const endDrag = () => {
    if (adj) adj.drag = null
  }
  cam.addEventListener('pointerup', endDrag)
  cam.addEventListener('pointercancel', endDrag)

  function closeAdjust(): void {
    adj = null
    $('scan-actions').classList.remove('adjusting')
    if (!stream) $('placeholder').hidden = false
  }

  $('cancel').addEventListener('click', () => {
    closeAdjust()
    setMsg(stream ? 'Hold the cube in view so the box can lock on.' : 'Start the camera, or upload a photo of a face.')
  })

  $('accept').addEventListener('click', () => {
    if (!adj) return
    const faces = adj.faces.map((f) => f.labs)
    closeAdjust()
    const added: string[] = []
    let repeats = 0
    for (const labs of faces) {
      if (session.complete) break
      if (session.matching(labs) >= 0) {
        repeats++
        continue
      }
      if (capture(labs)) added.push(nearestName(labs[4]).name)
    }
    if (session.complete) return // finishScan already ran
    const left = 6 - session.captures.length
    if (added.length) {
      setMsg(`Added ${added.join(', ')}.${left ? ` ${left} face${left > 1 ? 's' : ''} to go: photograph the opposite corner.` : ''}`)
    } else {
      setMsg(repeats ? 'Those faces are already captured. Turn the cube to a new corner.' : 'Nothing was added.', true)
    }
  })

  // ---------- buttons
  const fileInput = $<HTMLInputElement>('file')
  $('upload').addEventListener('click', () => {
    if (mode === 'review') {
      session.reset()
      enterScan()
    }
    fileInput.click()
  })
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0]
    fileInput.value = ''
    if (f) await readPhoto(f)
  })
  $('start').addEventListener('click', async () => {
    if (stream) return stopCamera()
    if (mode === 'review') {
      session.reset()
      enterScan()
    }
    await startCamera()
  })
  $('photo').addEventListener('click', takePhoto)
  $('reset').addEventListener('click', () => {
    session.reset()
    gates = []
    tracker.reset()
    cube = solvedCube()
    scheme = DEFAULT_SCHEME
    setMsg('')
    enterScan()
  })
  $('demo').addEventListener('click', () => {
    const moves = "R U R' U' F2 D L2 B' U2 F R' D2 L U'"
    useCube(applyMoves(solvedCube(), moves))
  })
  $('paint').addEventListener('click', () => useCube(solvedCube()))

  enterScan()
}
