'use client'

import type { SldLayout, SldElement } from '@/lib/sld-layout'

export function SldRenderer({ layout }: { layout: SldLayout }) {
  return (
    <svg
      id="sld-svg"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="w-full bg-white"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
      <rect width={layout.width} height={layout.height} fill="white" />
      {layout.elements.map((el, i) => renderElement(el, i))}
    </svg>
  )
}

function renderElement(el: SldElement, key: number): React.ReactNode {
  switch (el.type) {
    case 'rect':
      return (
        <rect key={key} x={el.x} y={el.y} width={el.w} height={el.h}
          fill={el.fill ?? 'none'} stroke={el.stroke ?? '#111'}
          strokeWidth={el.strokeWidth ?? 1}
          strokeDasharray={el.dash ? '4,3' : undefined}
        />
      )
    case 'line':
      return (
        <line key={key} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2}
          stroke={el.stroke ?? '#111'}
          strokeWidth={el.strokeWidth ?? 1}
          strokeDasharray={el.dash ? '4,3' : undefined}
        />
      )
    case 'circle':
      return (
        <circle key={key} cx={el.cx} cy={el.cy} r={el.r}
          fill="none" stroke={el.stroke ?? '#111'}
          strokeWidth={el.strokeWidth ?? 1}
        />
      )
    case 'text':
      return (
        <text key={key} x={el.x} y={el.y}
          fontSize={el.fontSize} textAnchor={el.anchor ?? 'start'}
          fontWeight={el.bold ? 'bold' : 'normal'}
          fontStyle={el.italic ? 'italic' : 'normal'}
          fill={el.fill ?? '#111'}
        >
          {el.text}
        </text>
      )
    case 'breaker':
      return (
        <g key={key}>
          <line x1={el.x} y1={el.y - 8} x2={el.x} y2={el.y - 2} stroke="#111" strokeWidth="1.5" />
          <line x1={el.x} y1={el.y - 2} x2={el.x + 5} y2={el.y + 6} stroke="#111" strokeWidth="1.5" />
          <line x1={el.x} y1={el.y + 8} x2={el.x} y2={el.y + 14} stroke="#111" strokeWidth="1.5" />
          <circle cx={el.x} cy={el.y - 2} r="1.5" fill="#111" />
          {el.label && <text x={el.x + 10} y={el.y + 2} fontSize="5.5" fill="#111">{el.label}</text>}
          {el.amps && <text x={el.x + 10} y={el.y + 9} fontSize="5" fill="#666">{el.amps}</text>}
        </g>
      )
    case 'disconnect':
      return (
        <g key={key}>
          <line x1={el.x} y1={el.y - 6} x2={el.x} y2={el.y} stroke="#111" strokeWidth="1.5" />
          <line x1={el.x} y1={el.y} x2={el.x + 6} y2={el.y - 8} stroke="#111" strokeWidth="2" />
          <circle cx={el.x} cy={el.y} r="2" fill="none" stroke="#111" strokeWidth="1" />
          <line x1={el.x} y1={el.y + 2} x2={el.x} y2={el.y + 8} stroke="#111" strokeWidth="1.5" />
          <text x={el.x + 10} y={el.y + 2} fontSize="5.5" fill="#111">{el.label}</text>
        </g>
      )
    case 'ground':
      return (
        <g key={key}>
          <line x1={el.x - 8} y1={el.y} x2={el.x + 8} y2={el.y} stroke="#111" strokeWidth="1.5" />
          <line x1={el.x - 5} y1={el.y + 4} x2={el.x + 5} y2={el.y + 4} stroke="#111" strokeWidth="1.5" />
          <line x1={el.x - 3} y1={el.y + 8} x2={el.x + 3} y2={el.y + 8} stroke="#111" strokeWidth="1.5" />
        </g>
      )
    case 'callout': {
      const r = el.r ?? 10
      return (
        <g key={key}>
          <circle cx={el.cx} cy={el.cy} r={r} fill="#111" stroke="#111" strokeWidth="1" />
          <text x={el.cx} y={el.cy + (r * 0.38)} fontSize={r * 1.2} textAnchor="middle" fill="white" fontWeight="bold">
            {el.number}
          </text>
        </g>
      )
    }
  }
}
