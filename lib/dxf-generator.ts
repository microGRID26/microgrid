/**
 * DXF (AutoCAD Drawing Exchange Format) Generator
 *
 * Produces valid DXF R12-compatible plain text files.
 * Used by the MicroGRID single-line diagram generator to create
 * professional electrical drawings for PE review.
 */

export class DxfBuilder {
  private entities: string[] = []
  private layers: Map<string, { color: number }> = new Map()

  /** Register a named layer with a DXF color number. */
  addLayer(name: string, color: number): void {
    this.layers.set(name, { color })
  }

  // ── Primitive entities ──────────────────────────────────────────────

  /** Add a LINE entity between two points. */
  addLine(x1: number, y1: number, x2: number, y2: number, layer: string): void {
    this.entities.push(
      [
        '0', 'LINE',
        '8', layer,
        '10', x1.toFixed(4),
        '20', y1.toFixed(4),
        '30', '0.0',
        '11', x2.toFixed(4),
        '21', y2.toFixed(4),
        '31', '0.0',
      ].join('\n')
    )
  }

  /** Add a rectangle (4 LINE entities). */
  addRect(x: number, y: number, w: number, h: number, layer: string): void {
    this.addLine(x, y, x + w, y, layer)
    this.addLine(x + w, y, x + w, y + h, layer)
    this.addLine(x + w, y + h, x, y + h, layer)
    this.addLine(x, y + h, x, y, layer)
  }

  /** Add a CIRCLE entity. */
  addCircle(cx: number, cy: number, r: number, layer: string): void {
    this.entities.push(
      [
        '0', 'CIRCLE',
        '8', layer,
        '10', cx.toFixed(4),
        '20', cy.toFixed(4),
        '30', '0.0',
        '40', r.toFixed(4),
      ].join('\n')
    )
  }

  /**
   * Add a TEXT or MTEXT entity.
   *
   * `halign` controls horizontal alignment:
   *   - `'left'`   (default) — simple TEXT entity at (x, y)
   *   - `'center'` — MTEXT with attachment point 6 (middle-center)
   *   - `'right'`  — MTEXT with attachment point 3 (top-right) shifted to middle-right (6 is MC, 3 is TR — we use 6 for center and 9 for BR family; for right we use attachment 3 adjusted)
   *
   * For simplicity we use MTEXT for aligned text and TEXT for left-aligned.
   */
  addText(
    x: number,
    y: number,
    height: number,
    text: string,
    layer: string,
    opts?: { halign?: 'left' | 'center' | 'right' }
  ): void {
    const align = opts?.halign ?? 'left'

    if (align === 'left') {
      this.entities.push(
        [
          '0', 'TEXT',
          '8', layer,
          '10', x.toFixed(4),
          '20', y.toFixed(4),
          '30', '0.0',
          '40', height.toFixed(4),
          '1', text,
        ].join('\n')
      )
    } else {
      // MTEXT attachment points: 1=TL  2=TC  3=TR  4=ML  5=MC  6=MR  7=BL  8=BC  9=BR
      const attachment = align === 'center' ? 5 : 6
      this.entities.push(
        [
          '0', 'MTEXT',
          '8', layer,
          '10', x.toFixed(4),
          '20', y.toFixed(4),
          '30', '0.0',
          '40', height.toFixed(4),
          '71', String(attachment),
          '1', text,
        ].join('\n')
      )
    }
  }

  // ── Electrical symbols ──────────────────────────────────────────────

  /**
   * Standard breaker symbol — two angled lines meeting at a contact
   * point (like a V on its side) with a perpendicular cross-line.
   * Drawn at (x, y) as the center of the symbol; total width ~0.6".
   */
  addBreakerSymbol(x: number, y: number, layer: string): void {
    const half = 0.3
    // Left lead-in
    this.addLine(x - half, y, x - 0.05, y, layer)
    // Right lead-out
    this.addLine(x + 0.05, y, x + half, y, layer)
    // Top angled arm (open contact, rotated)
    this.addLine(x - 0.05, y, x + 0.05, y + 0.2, layer)
    // Bottom angled arm
    this.addLine(x - 0.05, y, x + 0.05, y - 0.2, layer)
    // Perpendicular strike-through at contact
    this.addLine(x - 0.05, y - 0.15, x - 0.05, y + 0.15, layer)
  }

  /**
   * Disconnect switch symbol — a line with a gap and an angled line
   * showing the open position. Center at (x, y), width ~0.6".
   */
  addDisconnectSymbol(x: number, y: number, layer: string): void {
    const half = 0.3
    // Left lead
    this.addLine(x - half, y, x - 0.08, y, layer)
    // Right lead
    this.addLine(x + 0.08, y, x + half, y, layer)
    // Angled blade (open position — from left contact angled up-right)
    this.addLine(x - 0.08, y, x + 0.12, y + 0.22, layer)
    // Small contact dot represented as tiny circle
    this.addCircle(x + 0.08, y, 0.03, layer)
  }

  /**
   * Ground symbol — three horizontal lines of decreasing width, stacked.
   * Top line at (x, y), extends downward.
   */
  addGroundSymbol(x: number, y: number, layer: string): void {
    // Vertical stub down to first bar
    this.addLine(x, y, x, y - 0.15, layer)
    // Bar 1 (widest)
    this.addLine(x - 0.15, y - 0.15, x + 0.15, y - 0.15, layer)
    // Bar 2
    this.addLine(x - 0.10, y - 0.22, x + 0.10, y - 0.22, layer)
    // Bar 3 (narrowest)
    this.addLine(x - 0.05, y - 0.29, x + 0.05, y - 0.29, layer)
  }

  /**
   * Meter symbol — a circle with "kWh" text inside.
   * Center at (x, y), radius 0.25".
   */
  addMeterSymbol(x: number, y: number, layer: string): void {
    this.addCircle(x, y, 0.25, layer)
    this.addText(x, y - 0.06, 0.12, 'kWh', layer, { halign: 'center' })
  }

  // ── DXF output ──────────────────────────────────────────────────────

  /** Build the layer table entries. */
  private buildLayerTable(): string {
    const entries: string[] = []
    // Always include layer 0
    entries.push(
      ['0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS'].join('\n')
    )
    for (const [name, { color }] of this.layers) {
      entries.push(
        ['0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS'].join('\n')
      )
    }
    return entries.join('\n')
  }

  /** Build text-style table with a standard SIMPLEX style. */
  private buildStyleTable(): string {
    return [
      '0', 'STYLE',
      '2', 'STANDARD',
      '70', '0',
      '40', '0.0',
      '41', '1.0',
      '50', '0.0',
      '71', '0',
      '42', '0.2',
      '3', 'txt',
      '4', '',
    ].join('\n')
  }

  /** Assemble and return the complete DXF file as a string. */
  toString(): string {
    const sections: string[] = []

    // HEADER
    sections.push(
      [
        '0', 'SECTION',
        '2', 'HEADER',
        '9', '$ACADVER',
        '1', 'AC1009',
        '9', '$INSUNITS',
        '70', '1',
        '0', 'ENDSEC',
      ].join('\n')
    )

    // TABLES
    sections.push(
      [
        '0', 'SECTION',
        '2', 'TABLES',
        // Layer table
        '0', 'TABLE',
        '2', 'LAYER',
        '70', String(this.layers.size + 1),
        this.buildLayerTable(),
        '0', 'ENDTAB',
        // Style table
        '0', 'TABLE',
        '2', 'STYLE',
        '70', '1',
        this.buildStyleTable(),
        '0', 'ENDTAB',
        '0', 'ENDSEC',
      ].join('\n')
    )

    // ENTITIES
    sections.push(
      [
        '0', 'SECTION',
        '2', 'ENTITIES',
        ...this.entities,
        '0', 'ENDSEC',
      ].join('\n')
    )

    // EOF
    sections.push('0\nEOF')

    return sections.join('\n')
  }
}
