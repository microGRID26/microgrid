'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  loadWarehouseStock,
  addWarehouseStock,
  updateWarehouseStock,
  deleteWarehouseStock,
  checkoutFromWarehouse,
  checkinToWarehouse,
  adjustWarehouseStock,
  loadWarehouseTransactions,
  getLowStockItems,
  MATERIAL_CATEGORIES,
} from '@/lib/api/inventory'
import type { WarehouseStock, WarehouseTransaction } from '@/lib/api/inventory'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { fmtDate } from '@/lib/utils'
import {
  Warehouse, Search, Plus, X, ArrowDownToLine, ArrowUpFromLine,
  SlidersHorizontal, History, AlertTriangle, Package, Trash2, Printer,
} from 'lucide-react'

// ── Category badge colors ──────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  module: 'bg-blue-500/20 text-blue-400',
  inverter: 'bg-purple-500/20 text-purple-400',
  battery: 'bg-emerald-500/20 text-emerald-400',
  optimizer: 'bg-amber-500/20 text-amber-400',
  racking: 'bg-orange-500/20 text-orange-400',
  electrical: 'bg-red-500/20 text-red-400',
  other: 'bg-gray-500/20 text-gray-400',
}

// ── Transaction type colors ────────────────────────────────────────────────
const TX_TYPE_COLORS: Record<string, string> = {
  checkout: 'bg-red-500/20 text-red-400',
  checkin: 'bg-green-500/20 text-green-400',
  adjustment: 'bg-blue-500/20 text-blue-400',
  recount: 'bg-gray-500/20 text-gray-400',
}

type ModalType = null | 'add' | 'checkout' | 'checkin' | 'adjust' | 'history' | 'delete'

interface ProjectOption {
  id: string
  name: string
}

interface WarehouseTabProps {
  projects: Record<string, string> // id -> name mapping
}

export function WarehouseTab({ projects }: WarehouseTabProps) {
  const { user } = useCurrentUser()
  const [stock, setStock] = useState<WarehouseStock[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  // Modal state
  const [modal, setModal] = useState<ModalType>(null)
  const [selectedItem, setSelectedItem] = useState<WarehouseStock | null>(null)

  // Low stock
  const [lowStockItems, setLowStockItems] = useState<WarehouseStock[]>([])

  // Add form state
  const [addName, setAddName] = useState('')
  const [addCategory, setAddCategory] = useState('electrical')
  const [addQty, setAddQty] = useState(0)
  const [addReorder, setAddReorder] = useState(0)
  const [addUnit, setAddUnit] = useState('each')
  const [addLocation, setAddLocation] = useState('')
  const [addBarcode, setAddBarcode] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  // Checkout state
  const [coProject, setCoProject] = useState('')
  const [coProjectSearch, setCoProjectSearch] = useState('')
  const [coQty, setCoQty] = useState(1)
  const [coNotes, setCoNotes] = useState('')
  const [coSaving, setCoSaving] = useState(false)
  const [coDropdownOpen, setCoDropdownOpen] = useState(false)

  // Checkin state
  const [ciQty, setCiQty] = useState(1)
  const [ciNotes, setCiNotes] = useState('')
  const [ciSaving, setCiSaving] = useState(false)

  // Adjust state
  const [adjQty, setAdjQty] = useState(0)
  const [adjNotes, setAdjNotes] = useState('')
  const [adjSaving, setAdjSaving] = useState(false)

  // History state
  const [transactions, setTransactions] = useState<WarehouseTransaction[]>([])
  const [txLoading, setTxLoading] = useState(false)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Escape key closes any open modal ────────────────────────────────
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModal(null)
        setSelectedItem(null)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  // ── Load stock ──────────────────────────────────────────────────────────
  const fetchStock = useCallback(async () => {
    setLoading(true)
    const [items, lowItems] = await Promise.all([
      loadWarehouseStock(),
      getLowStockItems(),
    ])
    setStock(items)
    setLowStockItems(lowItems)
    setLoading(false)
  }, [])

  useEffect(() => { fetchStock() }, [fetchStock])

  // Reload just the low stock list (called after checkout/checkin/adjust to avoid stale counts)
  const refreshLowStock = useCallback(async () => {
    const items = await getLowStockItems()
    setLowStockItems(items)
  }, [])

  // ── Filtered stock ──────────────────────────────────────────────────────
  // Distinct locations for filter dropdown
  const distinctLocations = useMemo(() => {
    const locs = new Set<string>()
    for (const s of stock) {
      if (s.location) locs.add(s.location)
    }
    return Array.from(locs).sort()
  }, [stock])

  const filtered = useMemo(() => {
    let list = stock
    if (filterCategory) {
      list = list.filter(s => s.category === filterCategory)
    }
    if (filterLocation) {
      list = list.filter(s => s.location === filterLocation)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.location ?? '').toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.barcode ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [stock, filterCategory, filterLocation, search])

  // ── Summary counts ──────────────────────────────────────────────────────
  const totalItems = stock.length
  const totalUnits = stock.reduce((sum, s) => sum + s.quantity_on_hand, 0)
  const lowStockCount = lowStockItems.length

  // ── Project autocomplete ────────────────────────────────────────────────
  const projectOptions = useMemo((): ProjectOption[] => {
    const q = coProjectSearch.toLowerCase()
    if (!q) return []
    return Object.entries(projects)
      .filter(([id, name]) => id.toLowerCase().includes(q) || name.toLowerCase().includes(q))
      .slice(0, 10)
      .map(([id, name]) => ({ id, name }))
  }, [projects, coProjectSearch])

  // ── Open modal helpers ──────────────────────────────────────────────────
  function openCheckout(item: WarehouseStock) {
    setSelectedItem(item)
    setCoProject('')
    setCoProjectSearch('')
    setCoQty(1)
    setCoNotes('')
    setCoDropdownOpen(false)
    setModal('checkout')
  }

  function openCheckin(item: WarehouseStock) {
    setSelectedItem(item)
    setCiQty(1)
    setCiNotes('')
    setModal('checkin')
  }

  function openAdjust(item: WarehouseStock) {
    setSelectedItem(item)
    setAdjQty(item.quantity_on_hand)
    setAdjNotes('')
    setModal('adjust')
  }

  async function openHistory(item: WarehouseStock) {
    setSelectedItem(item)
    setTxLoading(true)
    setTransactions([])
    setModal('history')
    const txs = await loadWarehouseTransactions(item.id)
    setTransactions(txs)
    setTxLoading(false)
  }

  function openDelete(item: WarehouseStock) {
    setSelectedItem(item)
    setModal('delete')
  }

  function openAdd() {
    setAddName('')
    setAddCategory('electrical')
    setAddQty(0)
    setAddReorder(0)
    setAddUnit('each')
    setAddLocation(filterLocation || '')
    setAddBarcode('')
    setModal('add')
  }

  function closeModal() {
    setModal(null)
    setSelectedItem(null)
    // Reset all form state so stale values don't persist across modal reopens
    setCoQty(1)
    setCoProject('')
    setCoProjectSearch('')
    setCoNotes('')
    setCoDropdownOpen(false)
    setCiQty(1)
    setCiNotes('')
    setAdjQty(0)
    setAdjNotes('')
  }

  // ── Handlers ────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!addName.trim()) return
    setAddSaving(true)
    const result = await addWarehouseStock({
      equipment_id: null,
      name: addName.trim(),
      category: addCategory,
      quantity_on_hand: addQty,
      reorder_point: addReorder,
      unit: addUnit,
      location: addLocation.trim() || null,
      barcode: addBarcode.trim() || null,
      last_counted_at: null,
    })
    if (result) {
      setStock(prev => [...prev, result])
      if (result.quantity_on_hand <= result.reorder_point) {
        setLowStockItems(prev => [...prev, result])
      }
      closeModal()
      showToast('Stock item added')
    } else {
      showToast('Failed to add stock item')
    }
    setAddSaving(false)
  }

  async function handleCheckout() {
    if (!selectedItem || !coProject || coQty <= 0) return
    if (!user?.name) { showToast('Please wait — loading user'); return }
    setCoSaving(true)
    const ok = await checkoutFromWarehouse(
      selectedItem.id,
      coQty,
      coProject,
      user?.name ?? 'Unknown',
      coNotes.trim() || undefined
    )
    if (ok) {
      // Calculate new quantity directly from selectedItem (captured at modal open)
      // instead of reading from stock state to avoid stale closure issues
      const newQty = selectedItem.quantity_on_hand - coQty
      // Update local state
      setStock(prev =>
        prev.map(s =>
          s.id === selectedItem.id
            ? { ...s, quantity_on_hand: newQty, updated_at: new Date().toISOString() }
            : s
        )
      )
      // Refresh low stock using calculated value
      if (newQty <= selectedItem.reorder_point) {
        setLowStockItems(prev => {
          if (prev.some(i => i.id === selectedItem.id)) {
            return prev.map(i => i.id === selectedItem.id ? { ...i, quantity_on_hand: newQty } : i)
          }
          return [...prev, { ...selectedItem, quantity_on_hand: newQty }]
        })
      } else {
        setLowStockItems(prev => prev.filter(i => i.id !== selectedItem.id))
      }
      closeModal()
      showToast(`Checked out ${coQty} ${selectedItem.unit}(s) of ${selectedItem.name}`)
      refreshLowStock() // async reload for accuracy
    } else {
      showToast('Failed to check out stock — item may have been modified by another user')
    }
    setCoSaving(false)
  }

  async function handleCheckin() {
    if (!selectedItem || ciQty <= 0) return
    if (!user?.name) { showToast('Please wait — loading user'); return }
    setCiSaving(true)
    const ok = await checkinToWarehouse(
      selectedItem.id,
      ciQty,
      user?.name ?? 'Unknown',
      ciNotes.trim() || undefined
    )
    if (ok) {
      setStock(prev =>
        prev.map(s =>
          s.id === selectedItem.id
            ? { ...s, quantity_on_hand: s.quantity_on_hand + ciQty, updated_at: new Date().toISOString() }
            : s
        )
      )
      // Update low stock
      const updated = stock.find(s => s.id === selectedItem.id)
      if (updated) {
        const newQty = updated.quantity_on_hand + ciQty
        if (newQty > updated.reorder_point) {
          setLowStockItems(prev => prev.filter(i => i.id !== selectedItem.id))
        }
      }
      closeModal()
      showToast(`Checked in ${ciQty} ${selectedItem.unit}(s) of ${selectedItem.name}`)
      refreshLowStock() // async reload for accuracy
    } else {
      showToast('Failed to check in stock')
    }
    setCiSaving(false)
  }

  async function handleAdjust() {
    // adjQty === 0 is intentionally allowed — a physical count may confirm zero stock remaining
    if (!selectedItem || adjQty < 0) return
    if (!user?.name) { showToast('Please wait — loading user'); return }
    setAdjSaving(true)
    const ok = await adjustWarehouseStock(
      selectedItem.id,
      adjQty,
      user?.name ?? 'Unknown',
      adjNotes.trim() || undefined
    )
    if (ok) {
      setStock(prev =>
        prev.map(s =>
          s.id === selectedItem.id
            ? { ...s, quantity_on_hand: adjQty, last_counted_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            : s
        )
      )
      // Update low stock
      if (adjQty <= (selectedItem.reorder_point ?? 0)) {
        setLowStockItems(prev => {
          if (prev.some(i => i.id === selectedItem.id)) {
            return prev.map(i => i.id === selectedItem.id ? { ...i, quantity_on_hand: adjQty } : i)
          }
          return [...prev, { ...selectedItem, quantity_on_hand: adjQty }]
        })
      } else {
        setLowStockItems(prev => prev.filter(i => i.id !== selectedItem.id))
      }
      closeModal()
      showToast(`Adjusted ${selectedItem.name} to ${adjQty}`)
      refreshLowStock() // async reload for accuracy
    } else {
      showToast('Failed to adjust stock')
    }
    setAdjSaving(false)
  }

  async function handleDelete() {
    if (!selectedItem) return
    const ok = await deleteWarehouseStock(selectedItem.id)
    if (ok) {
      setStock(prev => prev.filter(s => s.id !== selectedItem.id))
      setLowStockItems(prev => prev.filter(s => s.id !== selectedItem.id))
      closeModal()
      showToast('Stock item deleted')
    } else {
      showToast('Failed to delete stock item')
    }
  }

  // ── Print label ──────────────────────────────────────────────────────────
  function printLabel(item: WarehouseStock) {
    const html = `<!DOCTYPE html>
<html><head><title>Label - ${item.name}</title>
<style>
@page { size: 2in 1in; margin: 0; }
body { font-family: Arial, sans-serif; width: 2in; height: 1in; padding: 4px 6px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; }
.name { font-size: 9px; font-weight: bold; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.barcode { font-size: 11px; font-family: monospace; font-weight: bold; letter-spacing: 1px; margin: 2px 0; }
.meta { font-size: 7px; color: #555; display: flex; justify-content: space-between; }
</style></head><body>
<div class="name">${item.name}</div>
<div class="barcode">${item.barcode || 'NO BARCODE'}</div>
<div class="meta"><span>${item.location || ''}</span><span>${item.category}</span></div>
</body></html>`
    const win = window.open('', '_blank', 'width=250,height=150')
    if (win) {
      win.document.write(html)
      win.document.close()
      win.focus()
      win.print()
    }
  }

  if (loading) {
    return <div className="text-gray-500 text-sm py-8 text-center">Loading warehouse stock...</div>
  }

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[200] bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* Low stock alert */}
      {lowStockCount > 0 && (
        <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm text-amber-300">
            {lowStockCount} item{lowStockCount !== 1 ? 's' : ''} below reorder point
          </span>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-800 rounded-lg p-3">
          <div className="text-xs text-gray-400">Total Items</div>
          <div className="text-xl font-bold text-white mt-1">{totalItems}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <div className="text-xs text-gray-400">Total Units</div>
          <div className="text-xl font-bold text-white mt-1">{totalUnits.toLocaleString()}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <div className="text-xs text-gray-400">Low Stock</div>
          <div className={`text-xl font-bold mt-1 ${lowStockCount > 0 ? 'text-amber-400' : 'text-white'}`}>
            {lowStockCount}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, location..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-gray-500"
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
        >
          <option value="">All Categories</option>
          {MATERIAL_CATEGORIES.map(c => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
        <select
          value={filterLocation}
          onChange={e => setFilterLocation(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
        >
          <option value="">All Locations</option>
          {distinctLocations.map(loc => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>
        <button
          onClick={openAdd}
          className="text-xs px-3 py-1.5 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add Stock Item
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <Warehouse className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {stock.length === 0 ? 'No warehouse stock items yet' : 'No items match your filters'}
          </p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-xs">
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Category</th>
                  <th className="text-center px-3 py-2">On Hand</th>
                  <th className="text-center px-3 py-2">Reorder Pt</th>
                  <th className="text-center px-3 py-2">Unit</th>
                  <th className="text-left px-3 py-2">Location</th>
                  <th className="text-left px-3 py-2">Barcode</th>
                  <th className="text-left px-3 py-2">Last Counted</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const isLow = item.quantity_on_hand <= item.reorder_point
                  return (
                    <tr key={item.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                      <td className="px-3 py-2 text-white font-medium">{item.name}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.other}`}>
                          {item.category}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-center font-mono font-medium ${isLow ? 'text-red-400' : 'text-gray-300'}`}>
                        {item.quantity_on_hand}
                        {isLow && <AlertTriangle className="w-3 h-3 text-amber-400 inline-block ml-1" />}
                      </td>
                      <td className="px-3 py-2 text-center text-gray-400 font-mono">{item.reorder_point}</td>
                      <td className="px-3 py-2 text-center text-gray-400">{item.unit}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs">{item.location || '\u2014'}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs font-mono">{item.barcode || '\u2014'}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs">{item.last_counted_at ? fmtDate(item.last_counted_at) : '\u2014'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openCheckout(item)}
                            className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                            title="Check out"
                          >
                            <ArrowUpFromLine className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openCheckin(item)}
                            className="p-1 rounded hover:bg-green-500/20 text-gray-400 hover:text-green-400 transition-colors"
                            title="Check in"
                          >
                            <ArrowDownToLine className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openAdjust(item)}
                            className="p-1 rounded hover:bg-blue-500/20 text-gray-400 hover:text-blue-400 transition-colors"
                            title="Adjust"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openHistory(item)}
                            className="p-1 rounded hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors"
                            title="History"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => printLabel(item)}
                            className="p-1 rounded hover:bg-indigo-500/20 text-gray-400 hover:text-indigo-400 transition-colors"
                            title="Print label"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openDelete(item)}
                            className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center" onClick={closeModal}>
          <div
            className="bg-gray-800 border border-gray-700 rounded-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* ── Add Stock Item ────────────────────────────────────────── */}
            {modal === 'add' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Plus className="w-4 h-4 text-green-400" /> Add Stock Item
                  </h3>
                  <button onClick={closeModal} aria-label="Close" className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-gray-400 block mb-1">Name *</label>
                    <input
                      value={addName}
                      onChange={e => setAddName(e.target.value)}
                      placeholder="e.g., MC4 Connectors"
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Category</label>
                    <select
                      value={addCategory}
                      onChange={e => setAddCategory(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                    >
                      {MATERIAL_CATEGORIES.map(c => (
                        <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Unit</label>
                    <select
                      value={addUnit}
                      onChange={e => setAddUnit(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                    >
                      <option value="each">each</option>
                      <option value="ft">ft</option>
                      <option value="box">box</option>
                      <option value="roll">roll</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Initial Quantity</label>
                    <input
                      type="number"
                      min={0}
                      value={addQty}
                      onChange={e => setAddQty(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Reorder Point</label>
                    <input
                      type="number"
                      min={0}
                      value={addReorder}
                      onChange={e => setAddReorder(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-400 block mb-1">Location</label>
                    <input
                      value={addLocation}
                      onChange={e => setAddLocation(e.target.value)}
                      placeholder="e.g., Main Warehouse, DFW1 Truck"
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                      list="location-suggestions"
                    />
                    <datalist id="location-suggestions">
                      {distinctLocations.map(loc => (
                        <option key={loc} value={loc} />
                      ))}
                    </datalist>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-400 block mb-1">Barcode</label>
                    <input
                      value={addBarcode}
                      onChange={e => setAddBarcode(e.target.value)}
                      placeholder="e.g., BOS-AWG10-001"
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white font-mono placeholder-gray-600"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={closeModal} className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">Cancel</button>
                  <button
                    onClick={handleAdd}
                    disabled={!addName.trim() || addSaving}
                    className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
                  >
                    {addSaving ? 'Adding...' : 'Add Item'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Checkout ──────────────────────────────────────────────── */}
            {modal === 'checkout' && selectedItem && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <ArrowUpFromLine className="w-4 h-4 text-red-400" /> Check Out: {selectedItem.name}
                  </h3>
                  <button onClick={closeModal} aria-label="Close" className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-xs text-gray-400">
                  Available: <span className="text-white font-mono">{selectedItem.quantity_on_hand}</span> {selectedItem.unit}(s)
                </p>

                {/* Project autocomplete */}
                <div className="relative">
                  <label className="text-xs text-gray-400 block mb-1">Project *</label>
                  <input
                    value={coProject ? `${coProject} — ${projects[coProject] || ''}` : coProjectSearch}
                    onChange={e => {
                      setCoProject('')
                      setCoProjectSearch(e.target.value)
                      setCoDropdownOpen(true)
                    }}
                    onFocus={() => setCoDropdownOpen(true)}
                    placeholder="Search project ID or name..."
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                  />
                  {coDropdownOpen && projectOptions.length > 0 && !coProject && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      {projectOptions.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setCoProject(p.id); setCoProjectSearch(''); setCoDropdownOpen(false) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-800 transition-colors"
                        >
                          <span className="text-green-400 font-mono">{p.id}</span>
                          <span className="text-gray-400 ml-2">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Quantity *</label>
                  <input
                    type="number"
                    min={1}
                    max={selectedItem.quantity_on_hand}
                    value={coQty}
                    onChange={e => setCoQty(Math.max(1, Math.min(selectedItem.quantity_on_hand, parseInt(e.target.value) || 1)))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                  />
                  {coQty > selectedItem.quantity_on_hand && (
                    <p className="text-xs text-red-400 mt-1">Cannot exceed available stock</p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Notes</label>
                  <textarea
                    value={coNotes}
                    onChange={e => setCoNotes(e.target.value)}
                    rows={2}
                    placeholder="Optional notes..."
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white resize-none placeholder-gray-600"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={closeModal} className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">Cancel</button>
                  <button
                    onClick={handleCheckout}
                    disabled={!coProject || coQty <= 0 || coQty > selectedItem.quantity_on_hand || coSaving}
                    className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                  >
                    {coSaving ? 'Processing...' : 'Check Out'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Check In ─────────────────────────────────────────────── */}
            {modal === 'checkin' && selectedItem && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <ArrowDownToLine className="w-4 h-4 text-green-400" /> Check In: {selectedItem.name}
                  </h3>
                  <button onClick={closeModal} aria-label="Close" className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-xs text-gray-400">
                  Current on hand: <span className="text-white font-mono">{selectedItem.quantity_on_hand}</span> {selectedItem.unit}(s)
                </p>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Quantity *</label>
                  <input
                    type="number"
                    min={1}
                    value={ciQty}
                    onChange={e => setCiQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Notes</label>
                  <textarea
                    value={ciNotes}
                    onChange={e => setCiNotes(e.target.value)}
                    rows={2}
                    placeholder='e.g., "Returned from PROJ-28490" or "Received from vendor"'
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white resize-none placeholder-gray-600"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={closeModal} className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">Cancel</button>
                  <button
                    onClick={handleCheckin}
                    disabled={ciQty <= 0 || ciSaving}
                    className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
                  >
                    {ciSaving ? 'Processing...' : 'Check In'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Adjust ───────────────────────────────────────────────── */}
            {modal === 'adjust' && selectedItem && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-blue-400" /> Adjust: {selectedItem.name}
                  </h3>
                  <button onClick={closeModal} aria-label="Close" className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-xs text-gray-400">
                  Current on hand: <span className="text-white font-mono">{selectedItem.quantity_on_hand}</span> {selectedItem.unit}(s)
                </p>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">New Quantity *</label>
                  <input
                    type="number"
                    min={0}
                    value={adjQty}
                    // parseInt || 0 fallback handles NaN from empty/invalid input — no additional validation needed
                    onChange={e => setAdjQty(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                  />
                  {adjQty !== selectedItem.quantity_on_hand && (
                    <p className="text-xs text-gray-500 mt-1">
                      Difference: <span className={adjQty > selectedItem.quantity_on_hand ? 'text-green-400' : 'text-red-400'}>
                        {adjQty > selectedItem.quantity_on_hand ? '+' : ''}{adjQty - selectedItem.quantity_on_hand}
                      </span>
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Notes</label>
                  <textarea
                    value={adjNotes}
                    onChange={e => setAdjNotes(e.target.value)}
                    rows={2}
                    placeholder={`e.g., "Physical count ${new Date().toISOString().split('T')[0]}"`}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white resize-none placeholder-gray-600"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={closeModal} className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">Cancel</button>
                  <button
                    onClick={handleAdjust}
                    disabled={adjQty < 0 || adjSaving}
                    className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
                  >
                    {adjSaving ? 'Adjusting...' : 'Set Quantity'}
                  </button>
                </div>
              </div>
            )}

            {/* ── History ──────────────────────────────────────────────── */}
            {modal === 'history' && selectedItem && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <History className="w-4 h-4 text-gray-400" /> History: {selectedItem.name}
                  </h3>
                  <button onClick={closeModal} aria-label="Close" className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                </div>

                {txLoading ? (
                  <div className="text-gray-500 text-sm py-4 text-center">Loading transactions...</div>
                ) : transactions.length === 0 ? (
                  <div className="text-gray-500 text-sm py-4 text-center">No transactions recorded yet</div>
                ) : (
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                    {transactions.map(tx => (
                      <div key={tx.id} className="bg-gray-900 rounded-lg px-3 py-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${TX_TYPE_COLORS[tx.transaction_type] || TX_TYPE_COLORS.recount}`}>
                            {tx.transaction_type}
                          </span>
                          <span className="text-xs text-gray-500">{fmtDate(tx.created_at)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-300">
                            Qty: <span className={`font-mono font-medium ${
                              tx.transaction_type === 'checkout' ? 'text-red-400' :
                              tx.transaction_type === 'checkin' ? 'text-green-400' :
                              'text-blue-400'
                            }`}>
                              {tx.transaction_type === 'checkout' ? '-' : tx.transaction_type === 'checkin' ? '+' : ''}{Math.abs(tx.quantity)}
                            </span>
                          </span>
                          {tx.project_id && (
                            <span className="text-green-400 font-mono">{tx.project_id}</span>
                          )}
                        </div>
                        {tx.performed_by && (
                          <div className="text-xs text-gray-500">By: {tx.performed_by}</div>
                        )}
                        {tx.notes && (
                          <div className="text-xs text-gray-400">{tx.notes}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button onClick={closeModal} className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">Close</button>
                </div>
              </div>
            )}

            {/* ── Delete confirmation ─────────────────────────────────── */}
            {modal === 'delete' && selectedItem && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-red-400" /> Delete Stock Item
                  </h3>
                  <button onClick={closeModal} aria-label="Close" className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-sm text-gray-300">
                  Are you sure you want to delete <span className="text-white font-medium">{selectedItem.name}</span>?
                  This cannot be undone.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={closeModal} className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">Cancel</button>
                  <button
                    onClick={handleDelete}
                    className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
