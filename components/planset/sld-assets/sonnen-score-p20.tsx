'use client'

import type { AssetProps } from './index'

// SonnenCore+ SCORE-P20 battery enclosure — Phase 1 hybrid renderer asset.
// Native viewBox 0 0 360 280. Drawn by Claude Design, integrated 2026-05-05.
// Anchor points are non-visual <g id="..."> markers procedural code reads via DOM.
export function SonnenScoreP20({ x, y, w, h }: AssetProps) {
  const sx = w / 360
  const sy = h / 280
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.6" y="0.6" width="358.8" height="278.8" rx="6" ry="6" fill="white" stroke="#111" strokeWidth="1.2" />
      <line x1="0.6" y1="22" x2="359.4" y2="22" stroke="#111" strokeWidth="1.2" />

      <text x="80" y="15" fontSize="10" fontStyle="italic" fill="#222" textAnchor="middle">SonnenCore+</text>

      <g fill="#222" stroke="#111" strokeWidth="0.4">
        <rect x="140" y="8" width="6" height="6" />
        <rect x="148" y="8" width="6" height="6" />
        <rect x="156" y="8" width="6" height="6" />
        <rect x="164" y="8" width="6" height="6" />
      </g>
      <text x="155" y="20" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">MICRO</text>

      <g fill="#222" stroke="#111" strokeWidth="0.4">
        <rect x="200" y="8" width="6" height="6" />
        <rect x="208" y="8" width="6" height="6" />
        <rect x="216" y="8" width="6" height="6" />
        <rect x="224" y="8" width="6" height="6" />
      </g>
      <text x="215" y="20" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">GRID</text>

      <g fill="#222" stroke="#111" strokeWidth="0.4">
        <rect x="240" y="8" width="6" height="6" />
        <rect x="248" y="8" width="6" height="6" />
        <rect x="256" y="8" width="6" height="6" />
        <rect x="264" y="8" width="6" height="6" />
      </g>
      <text x="255" y="20" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">GRID</text>

      <text x="180" y="34" fontSize="7" fontWeight="bold" fill="#222" textAnchor="middle">SCORE-P20 (20 kWh) 4.8 kW AC SYSTEM</text>

      <g id="cell-grid" stroke="#444" fill="white">
        <symbol id="lifepo4-cell" viewBox="0 0 75 55" overflow="visible">
          <rect x="0.3" y="0.3" width="74.4" height="54.4" rx="2" ry="2" stroke="#444" strokeWidth="0.6" fill="white" />
          <g stroke="#444" strokeWidth="0.35" opacity="0.85">
            <line x1="3" y1="8" x2="72" y2="8" />
            <line x1="3" y1="13" x2="72" y2="13" />
            <line x1="3" y1="18" x2="72" y2="18" />
            <line x1="3" y1="23" x2="72" y2="23" />
            <line x1="3" y1="32" x2="72" y2="32" />
            <line x1="3" y1="37" x2="72" y2="37" />
            <line x1="3" y1="42" x2="72" y2="42" />
            <line x1="3" y1="47" x2="72" y2="47" />
          </g>
          <text x="37.5" y="28.2" fontSize="4.5" fontWeight="600" fill="#222" textAnchor="middle">102 VDC NOMINAL</text>
          <text x="37.5" y="34.2" fontSize="4.5" fill="#222" textAnchor="middle">LiFePO4</text>
        </symbol>

        <use href="#lifepo4-cell" x="12" y="42" width="75" height="55" />
        <use href="#lifepo4-cell" x="95" y="42" width="75" height="55" />
        <use href="#lifepo4-cell" x="12" y="103" width="75" height="55" />
        <use href="#lifepo4-cell" x="95" y="103" width="75" height="55" />
      </g>

      <rect x="12" y="160" width="158" height="20" rx="1.5" ry="1.5" fill="white" stroke="#444" strokeWidth="0.6" />
      <text x="91" y="173" fontSize="6" fontWeight="bold" fill="#222" textAnchor="middle">CONTROLS (PCS)</text>
      <g stroke="#444" strokeWidth="0.3" opacity="0.6">
        <line x1="40" y1="164" x2="40" y2="176" />
        <line x1="142" y1="164" x2="142" y2="176" />
      </g>

      <text x="172" y="192" fontSize="6" fontWeight="bold" fill="#222" textAnchor="middle">PRIMARY</text>

      <g fill="white" stroke="#111" strokeWidth="0.7">
        <rect x="119" y="208" width="22" height="10" rx="2" ry="2" />
        <rect x="147" y="208" width="22" height="10" rx="2" ry="2" />
        <rect x="175" y="208" width="22" height="10" rx="2" ry="2" />
        <rect x="203" y="208" width="22" height="10" rx="2" ry="2" />
      </g>
      <g fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">
        <text x="130" y="215.5">L1</text>
        <text x="158" y="215.5">L2</text>
        <text x="186" y="215.5">N</text>
        <text x="214" y="215.5">G</text>
      </g>

      <rect x="286" y="42" width="60" height="26" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="0.8" />
      <text x="316" y="59" fontSize="7" fontWeight="bold" fill="#222" textAnchor="middle">E-STOP</text>
      <text x="316" y="76" fontSize="3.8" fill="#666" textAnchor="middle">E-STOP ISOLATES</text>
      <text x="316" y="80.5" fontSize="3.8" fill="#666" textAnchor="middle">BATTERY FROM GRID</text>

      <text x="180" y="248" fontSize="4.5" fill="#666" textAnchor="middle">UL 9540 · UL 1741 · IEEE 1547 · PREPA 2013</text>
      <text x="180" y="256" fontSize="4.5" fill="#666" textAnchor="middle">240 VAC, 1Φ 3W</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-micro-in" transform="translate(155, 8)" />
        <g id="anchor-grid-in" transform="translate(215, 8)" />
        <g id="anchor-grid-out" transform="translate(255, 8)" />
        <g id="anchor-estop-out" transform="translate(346, 55)" />
        <g id="anchor-primary-l1" transform="translate(130, 218)" />
        <g id="anchor-primary-l2" transform="translate(158, 218)" />
        <g id="anchor-primary-n" transform="translate(186, 218)" />
        <g id="anchor-primary-g" transform="translate(214, 218)" />
      </g>
    </g>
  )
}
