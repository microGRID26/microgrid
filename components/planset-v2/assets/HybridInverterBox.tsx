// Hybrid inverter — Duracell PC-MAX / Sonnen ESS hybrid. Carries PV-DC in,
// battery-DC bi-dir, AC OUT, and BACKUP AC ports.

import type { HybridInverter } from '../../../lib/sld-v2/equipment'

export interface HybridInverterBoxProps {
  inv: HybridInverter
  x: number
  y: number
  debug?: boolean
}

export function HybridInverterBox({ inv, x, y, debug }: HybridInverterBoxProps) {
  const { width: w, height: h } = inv
  const { model, acKw, backupAcA, listingStandard, branchCircuit, moduleCount } = inv.props
  const sx = w / 110
  const sy = h / 100

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        <rect x="0.5" y="0.5" width="109" height="99" rx="3" ry="3" fill="white" stroke="#111" strokeWidth="1.4" />

        {/* Name header */}
        <text x="55" y="13" fontSize="6.5" fontWeight="bold" fill="#222" textAnchor="middle">
          (N) HYBRID #{branchCircuit ?? 1} · {acKw} kW AC
        </text>
        <text x="55" y="20" fontSize="3.8" fill="#444" textAnchor="middle">{model}</text>
        {branchCircuit != null && moduleCount != null && (
          <text x="55" y="26" fontSize="3.6" fontWeight="bold" fill="#0e7490" textAnchor="middle">
            BRANCH CIRCUIT {branchCircuit} · {moduleCount} MODULES
          </text>
        )}
        <text x="55" y="32" fontSize="3.5" fill="#666" textAnchor="middle">102 VDC NOMINAL · {listingStandard}</text>

        {/* Port labels — small badges */}
        <rect x="6" y="42" width="22" height="10" rx="1" fill="#f0f9ff" stroke="#22d3ee" strokeWidth="0.5" />
        <text x="17" y="49" fontSize="4" fill="#0e7490" textAnchor="middle">PV DC</text>

        <rect x="82" y="42" width="22" height="10" rx="1" fill="#fef3c7" stroke="#d97706" strokeWidth="0.5" />
        <text x="93" y="49" fontSize="4" fill="#92400e" textAnchor="middle">AC OUT</text>

        <rect x="6" y="60" width="22" height="10" rx="1" fill="#dcfce7" stroke="#16a34a" strokeWidth="0.5" />
        <text x="17" y="67" fontSize="4" fill="#166534" textAnchor="middle">BATT</text>

        {backupAcA != null && (
          <>
            <rect x="82" y="60" width="22" height="10" rx="1" fill="#fde2e8" stroke="#be185d" strokeWidth="0.5" />
            <text x="93" y="65" fontSize="3.5" fill="#831843" textAnchor="middle">BACKUP</text>
            <text x="93" y="69" fontSize="3" fill="#831843" textAnchor="middle">{backupAcA}A</text>
          </>
        )}

        {/* MPPT marker */}
        <text x="55" y="78" fontSize="4" fill="#888" textAnchor="middle">MPPT-1</text>

        {/* Standard listing footer */}
        <text x="55" y="92" fontSize="3.5" fill="#888" textAnchor="middle">UL 9540 · IEEE 1547</text>

        <g id={`anchors-${inv.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${inv.id}-N`} transform="translate(55, 0)" />
          <g id={`${inv.id}-S`} transform="translate(55, 100)" />
          <g id={`${inv.id}-W-pv`} transform="translate(0, 47)" />
          <g id={`${inv.id}-W-batt`} transform="translate(0, 65)" />
          <g id={`${inv.id}-E-ac`} transform="translate(110, 47)" />
          <g id={`${inv.id}-E-backup`} transform="translate(110, 65)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="55" cy="0" r="1.5" fill="cyan" />
            <circle cx="55" cy="100" r="1.5" fill="cyan" />
            <circle cx="0" cy="47" r="1.5" fill="cyan" />
            <circle cx="0" cy="65" r="1.5" fill="cyan" />
            <circle cx="110" cy="47" r="1.5" fill="cyan" />
            <circle cx="110" cy="65" r="1.5" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
