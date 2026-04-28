'use client'

import { useState, useEffect, useRef } from 'react'
import { polygonToSvgPath, isValidPolygon } from '@/lib/planset-polygons'
import type { PlansetRoofFace } from '@/lib/planset-types'

interface Props {
  faceId: number
  initialPolygon: Array<[number, number]>
  initialSetbacks?: PlansetRoofFace['setbacks']
  onSave: (polygon: Array<[number, number]>, setbacks: PlansetRoofFace['setbacks']) => void
  onClose: () => void
}

const W = 600
const H = 400
// Distinguish click-add from drag-end on pointerup. Anything under this
// threshold (in canvas pixels) is treated as a tap, not a drag.
const DRAG_THRESHOLD_PX = 3

type Pt = [number, number]

export function RoofPolygonEditor({ faceId, initialPolygon, initialSetbacks, onSave, onClose }: Props) {
  // Convert normalized initial polygon to canvas coords
  const [points, setPoints] = useState<Pt[]>(
    initialPolygon.map(([x, y]) => [x * W, y * H] as Pt)
  )
  const [setbacks, setSetbacks] = useState<PlansetRoofFace['setbacks']>(
    initialSetbacks ?? { ridge: false, eave: false, rake: false, pathClear: 'walkable' }
  )

  // Undo/redo history stacks. Each entry is a full `points` snapshot.
  // commit() pushes current state to undo and clears redo (any new edit
  // invalidates the redo timeline). undo() pops from undo onto current,
  // pushing the current state onto redo first.
  const [undoStack, setUndoStack] = useState<Pt[][]>([])
  const [redoStack, setRedoStack] = useState<Pt[][]>([])

  // Drag state — index of vertex being dragged; null when not dragging.
  // dragOriginRef captures the points snapshot at drag start so we only push
  // ONE history entry per drag (regardless of how many pointermove ticks fire).
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const dragOriginRef = useRef<Pt[] | null>(null)
  const dragMovedRef = useRef<boolean>(false)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // Snapshot the CURRENT points into the undo stack before mutating. Caller
  // passes `next` for the new state. Clears redo (linear undo timeline).
  const commit = (next: Pt[]) => {
    setUndoStack(s => [...s, points])
    setRedoStack([])
    setPoints(next)
  }

  const undo = () => {
    setUndoStack(s => {
      if (s.length === 0) return s
      const prev = s[s.length - 1]
      setRedoStack(r => [...r, points])
      setPoints(prev)
      return s.slice(0, -1)
    })
  }

  const redo = () => {
    setRedoStack(r => {
      if (r.length === 0) return r
      const next = r[r.length - 1]
      setUndoStack(s => [...s, points])
      setPoints(next)
      return r.slice(0, -1)
    })
  }

  // Keybindings: Esc closes; Cmd/Ctrl+Z undo; Cmd/Ctrl+Shift+Z (or +Y) redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, points, undoStack, redoStack])

  function clientToCanvas(e: React.PointerEvent | React.MouseEvent): Pt {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const rect = svg.getBoundingClientRect()
    // Scale because the SVG may render smaller than its 600x400 viewBox.
    const sx = W / rect.width
    const sy = H / rect.height
    return [(e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy]
  }

  function onVertexPointerDown(i: number, e: React.PointerEvent<SVGCircleElement>) {
    // Start drag on this vertex; suppress the canvas click-to-add.
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDragIndex(i)
    dragOriginRef.current = points
    dragMovedRef.current = false
  }

  function onCanvasPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragIndex === null) return
    const [x, y] = clientToCanvas(e)
    setPoints(prev => {
      const origin = dragOriginRef.current
      if (!origin) return prev
      const start = origin[dragIndex]
      if (!dragMovedRef.current) {
        const dx = x - start[0]
        const dy = y - start[1]
        if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) dragMovedRef.current = true
      }
      const next = prev.slice() as Pt[]
      next[dragIndex] = [x, y]
      return next
    })
  }

  function onCanvasPointerUp() {
    if (dragIndex === null) return
    const origin = dragOriginRef.current
    const moved = dragMovedRef.current
    setDragIndex(null)
    dragOriginRef.current = null
    dragMovedRef.current = false
    // Only commit a history entry if the vertex actually moved past the
    // threshold. A pure tap is a no-op (avoids polluting the undo stack).
    if (moved && origin) {
      setUndoStack(s => [...s, origin])
      setRedoStack([])
    }
  }

  function onCanvasClick(e: React.MouseEvent<SVGSVGElement>) {
    // If a drag just ended, the click that fires on pointerup is a no-op.
    // Tap-on-vertex (no movement) was suppressed via stopPropagation in
    // onVertexPointerDown's parent listener — but pointerup may still fire
    // a synthetic click on the SVG; guard against it.
    if (dragIndex !== null) return
    const [x, y] = clientToCanvas(e)
    commit([...points, [x, y]])
  }

  function handleSave() {
    const normalized = points.map(([x, y]) => [x / W, y / H] as Pt)
    onSave(normalized, setbacks)
  }

  function handleClear() {
    if (points.length === 0) return
    if (!window.confirm(`Discard ${points.length} placed vertices?`)) return
    commit([])
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    // Float === would falsely flag identical polygons after JSON round-trip
    // drift; use 1e-6 pixel epsilon (well below any visible difference at the
    // editor's 600×400 canvas).
    const initial = initialPolygon.map(([x, y]) => [x * W, y * H] as Pt)
    const PIXEL_EPS = 1e-6
    const changed = points.length !== initial.length ||
      points.some((p, i) =>
        Math.abs(p[0] - (initial[i]?.[0] ?? 0)) > PIXEL_EPS ||
        Math.abs(p[1] - (initial[i]?.[1] ?? 0)) > PIXEL_EPS
      )
    if (changed && !window.confirm('Discard unsaved polygon changes?')) return
    onClose()
  }

  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (canSave) handleSave()
  }

  const canSave = isValidPolygon(points.map(([x, y]) => [x / W, y / H] as Pt))
  const canUndo = undoStack.length > 0
  const canRedo = redoStack.length > 0

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <form
        className="bg-gray-800 rounded-lg p-4 max-w-3xl w-full"
        onSubmit={handleFormSubmit}
      >
        <header className="flex justify-between items-center mb-3">
          <h2 className="text-white text-lg font-medium">
            Roof Plane Editor — Face #{faceId}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white">
            ✕
          </button>
        </header>

        <p className="text-gray-300 text-sm mb-2">
          Click to add a vertex. Drag a vertex to move it. <kbd className="bg-gray-700 px-1 rounded">⌘Z</kbd> undo,{' '}
          <kbd className="bg-gray-700 px-1 rounded">⌘⇧Z</kbd> redo. Set setback flags below per face.
        </p>

        <svg
          ref={svgRef}
          data-testid="polygon-canvas"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          onClick={onCanvasClick}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          className={`bg-gray-100 ${dragIndex !== null ? 'cursor-grabbing' : 'cursor-crosshair'}`}
        >
          {points.length >= 3 && (
            <path
              d={polygonToSvgPath(points)}
              fill="rgba(0,128,255,0.2)"
              stroke="#06f"
              strokeWidth={2}
            />
          )}
          {points.map(([x, y], i) => (
            <circle
              key={i}
              data-vertex-index={i}
              cx={x}
              cy={y}
              r={6}
              fill={i === dragIndex ? '#0af' : '#06f'}
              stroke="#fff"
              strokeWidth={1.5}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => onVertexPointerDown(i, e)}
            />
          ))}
        </svg>

        <div className="grid grid-cols-2 gap-3 mt-3 text-white text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Ridge setback required"
              checked={setbacks.ridge}
              onChange={e => setSetbacks({ ...setbacks, ridge: e.target.checked })}
            />
            Ridge setback required
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Eave setback required"
              checked={setbacks.eave}
              onChange={e => setSetbacks({ ...setbacks, eave: e.target.checked })}
            />
            Eave setback required
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Rake setback required"
              checked={setbacks.rake}
              onChange={e => setSetbacks({ ...setbacks, rake: e.target.checked })}
            />
            Rake setback required
          </label>
          <label className="flex items-center gap-2">
            <span>Path:</span>
            <select
              value={setbacks.pathClear}
              onChange={e => setSetbacks({ ...setbacks, pathClear: e.target.value as 'walkable' | 'partial' | 'blocked' })}
              className="bg-gray-700 text-white px-2 py-1 rounded"
            >
              <option value="walkable">Walkable</option>
              <option value="partial">Partial</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
        </div>

        <footer className="mt-4 flex flex-col gap-2">
          {!canSave && (
            <p className="text-xs text-amber-400">
              Need at least 3 non-degenerate vertices for a valid polygon ({points.length} placed)
            </p>
          )}
          <div className="flex gap-2 justify-end items-center">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              aria-label="Undo"
              className={`px-3 py-1.5 rounded text-sm ${canUndo ? 'bg-gray-600 text-white hover:bg-gray-500' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
            >
              Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo"
              className={`px-3 py-1.5 rounded text-sm ${canRedo ? 'bg-gray-600 text-white hover:bg-gray-500' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
            >
              Redo
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-500"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className={`px-3 py-1.5 rounded ${canSave ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-gray-500 text-gray-300 cursor-not-allowed'}`}
            >
              Save
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}
