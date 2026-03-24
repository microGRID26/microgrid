'use client'

interface FilesTabProps {
  folderUrl: string | null
}

export function FilesTab({ folderUrl }: FilesTabProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      {folderUrl ? (
        <a href={folderUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl px-6 py-4 transition-colors">
          <img src="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png" alt="Drive" className="w-8 h-8" />
          <span className="text-sm font-semibold text-white">Open in Google Drive ↗</span>
        </a>
      ) : (
        <div className="text-gray-500 text-sm text-center">
          <div className="text-2xl mb-2">📁</div>
          No Drive folder linked to this project.
        </div>
      )}
    </div>
  )
}
