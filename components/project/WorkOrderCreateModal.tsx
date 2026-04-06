import React from 'react'

interface WorkOrderCreateModalProps {
  projectName: string
  projectId: string
  woType: string
  setWoType: (v: string) => void
  woCreating: boolean
  onClose: () => void
  onCreate: () => void
}

export function WorkOrderCreateModal({ projectName, projectId, woType, setWoType, woCreating, onClose, onCreate }: WorkOrderCreateModalProps) {
  return (
    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Create Work Order</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">&times;</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Project</label>
            <div className="text-sm text-white">{projectName} ({projectId})</div>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Type</label>
            <select value={woType} onChange={e => setWoType(e.target.value)}
              className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none">
              <option value="install">Installation</option>
              <option value="service">Service</option>
              <option value="inspection">Inspection</option>
              <option value="rnr">Roof Remove & Reinstall</option>
              <option value="survey">Survey</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
          <button
            onClick={onCreate}
            disabled={woCreating}
            className="px-4 py-1.5 text-xs bg-green-600 hover:bg-green-500 text-white rounded-md font-medium disabled:opacity-50"
          >
            {woCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
