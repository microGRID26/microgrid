import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmt$(n: number | null | undefined): string {
  if (!n) return '$0'
  return '$' + Number(n).toLocaleString()
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  } catch { return '' }
}

export function daysAgo(d: string | null | undefined): number {
  if (!d) return 0
  const n = new Date(d + 'T00:00:00')
  if (isNaN(n.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - n.getTime()) / 86400000))
}

export const STAGE_LABELS: Record<string, string> = {
  evaluation: 'Evaluation',
  survey: 'Site Survey',
  design: 'Design',
  permit: 'Permitting',
  install: 'Installation',
  inspection: 'Inspection',
  complete: 'Completion',
}

export const STAGE_ORDER = ['evaluation','survey','design','permit','install','inspection','complete']
