import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoofPolygonEditor } from '@/app/planset/components/RoofPolygonEditor'

// jsdom returns getBoundingClientRect() = 0×0 by default. Coordinate math
// in clientToCanvas() divides by rect.width — without a stub that yields NaN
// and breaks the click-to-add path. Stub a 600×400 rect (matching the editor's
// W × H constants) so click coords map 1:1 to canvas coords.
const stubBoundingRect = (svg: SVGSVGElement) => {
  svg.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 400, width: 600, height: 400,
    toJSON: () => ({}),
  })
}

const baseProps = {
  faceId: 1,
  initialPolygon: [] as Array<[number, number]>,
  onSave: vi.fn(),
  onClose: vi.fn(),
}

describe('RoofPolygonEditor — undo / redo', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Undo button starts disabled when there is no history', () => {
    render(<RoofPolygonEditor {...baseProps} />)
    expect(screen.getByLabelText('Undo')).toBeDisabled()
    expect(screen.getByLabelText('Redo')).toBeDisabled()
  })

  it('clicking on the canvas adds a vertex and enables Undo', () => {
    const { container } = render(<RoofPolygonEditor {...baseProps} />)
    const svg = container.querySelector('svg[data-testid="polygon-canvas"]') as SVGSVGElement
    stubBoundingRect(svg)
    fireEvent.click(svg, { clientX: 100, clientY: 100 })
    expect(container.querySelectorAll('circle[data-vertex-index]').length).toBe(1)
    expect(screen.getByLabelText('Undo')).not.toBeDisabled()
  })

  it('Undo reverts the last add and enables Redo; Redo restores it', () => {
    const { container } = render(<RoofPolygonEditor {...baseProps} />)
    const svg = container.querySelector('svg[data-testid="polygon-canvas"]') as SVGSVGElement
    stubBoundingRect(svg)
    fireEvent.click(svg, { clientX: 100, clientY: 100 })
    fireEvent.click(svg, { clientX: 200, clientY: 200 })
    expect(container.querySelectorAll('circle[data-vertex-index]').length).toBe(2)

    fireEvent.click(screen.getByLabelText('Undo'))
    expect(container.querySelectorAll('circle[data-vertex-index]').length).toBe(1)
    expect(screen.getByLabelText('Redo')).not.toBeDisabled()

    fireEvent.click(screen.getByLabelText('Redo'))
    expect(container.querySelectorAll('circle[data-vertex-index]').length).toBe(2)
    expect(screen.getByLabelText('Redo')).toBeDisabled()
  })

  it('a new edit after undo invalidates the redo stack', () => {
    const { container } = render(<RoofPolygonEditor {...baseProps} />)
    const svg = container.querySelector('svg[data-testid="polygon-canvas"]') as SVGSVGElement
    stubBoundingRect(svg)
    fireEvent.click(svg, { clientX: 100, clientY: 100 })
    fireEvent.click(svg, { clientX: 200, clientY: 200 })
    fireEvent.click(screen.getByLabelText('Undo'))
    expect(screen.getByLabelText('Redo')).not.toBeDisabled()

    // New edit on top of the rewound state — redo timeline is now invalid.
    fireEvent.click(svg, { clientX: 300, clientY: 300 })
    expect(screen.getByLabelText('Redo')).toBeDisabled()
  })

  it('Clear puts an entry on the undo stack so it can be undone', () => {
    const { container } = render(<RoofPolygonEditor {...baseProps} />)
    const svg = container.querySelector('svg[data-testid="polygon-canvas"]') as SVGSVGElement
    stubBoundingRect(svg)
    fireEvent.click(svg, { clientX: 100, clientY: 100 })
    fireEvent.click(svg, { clientX: 200, clientY: 200 })
    fireEvent.click(svg, { clientX: 300, clientY: 300 })
    expect(container.querySelectorAll('circle[data-vertex-index]').length).toBe(3)

    fireEvent.click(screen.getByText('Clear'))
    expect(container.querySelectorAll('circle[data-vertex-index]').length).toBe(0)

    fireEvent.click(screen.getByLabelText('Undo'))
    expect(container.querySelectorAll('circle[data-vertex-index]').length).toBe(3)
  })
})
