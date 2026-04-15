'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { db } from '@/lib/db'
import {
  CheckCircle2, XCircle, Ban, SkipForward, Circle,
  ExternalLink, Columns2, Maximize2, RotateCcw,
  Camera, X, Send, Loader2,
} from 'lucide-react'
import type { TestCase, TestResult, TestComment, Status } from '../types'
import { STATUS_META, PRIORITY_META } from '../types'

/** Strip dangerous tags/attributes from HTML to prevent stored XSS */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s>][\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s>][\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s>][\s\S]*?>/gi, '')
    .replace(/<link[\s>][\s\S]*?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=[^\s>]*/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:[^;]*;base64/gi, '')
}

interface SplitViewProps {
  selectedCase: TestCase
  resultMap: Map<string, TestResult>
  feedback: string
  setFeedback: (v: string) => void
  submitting: boolean
  submitResult: (status: Status) => void
  screenshot: { file: File; preview: string } | null
  setScreenshot: (v: { file: File; preview: string } | null) => void
  handleScreenshotFile: (f: File) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  currentUser: { id: string; name: string } | null
}

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

export function SplitView({
  selectedCase, resultMap, feedback, setFeedback,
  submitting, submitResult, screenshot, setScreenshot,
  handleScreenshotFile, fileInputRef, currentUser,
}: SplitViewProps) {
  const [comments, setComments] = useState<TestComment[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [commentLoading, setCommentLoading] = useState(false)
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [splitMode, setSplitMode] = useState(true)

  const currentResult = resultMap.get(selectedCase.id)
  const hasPageUrl = !!selectedCase.page_url

  const iframeUrl = useMemo(() => {
    if (!selectedCase.page_url) return null
    const url = selectedCase.page_url
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}testing=true`
  }, [selectedCase.page_url])

  const showSplit = hasPageUrl && splitMode

  // Load comments
  useEffect(() => {
    if (!currentResult) { setComments([]); return }
    setCommentLoading(true)
    db()
      .from('test_comments')
      .select('id, test_result_id, author_id, body, created_at, author:users!test_comments_author_id_fkey ( name )')
      .eq('test_result_id', currentResult.id)
      .order('created_at', { ascending: true })
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        const items: TestComment[] = (data ?? []).map((row) => {
          const author = row.author as { name: string } | null
          return {
            id: row.id as string,
            test_result_id: row.test_result_id as string,
            author_id: row.author_id as string,
            body: row.body as string,
            created_at: row.created_at as string,
            author_name: author?.name ?? 'Unknown',
          }
        })
        setComments(items)
        setCommentLoading(false)
      })
  }, [currentResult?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const addComment = useCallback(async () => {
    if (!commentBody.trim() || !currentResult || !currentUser) return
    setCommentSubmitting(true)
    const { data } = await db()
      .from('test_comments')
      .insert({ test_result_id: currentResult.id, author_id: currentUser.id, body: commentBody.trim() })
      .select('id, test_result_id, author_id, body, created_at')
      .single()
    if (data) {
      setComments(prev => [...prev, { ...data, author_name: currentUser.name }])
      setCommentBody('')
    }
    setCommentSubmitting(false)
  }, [commentBody, currentResult, currentUser])

  const instructionsPanel = (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="bg-gradient-to-r from-green-500/5 to-transparent px-6 py-4 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_META[selectedCase.priority]?.cls ?? PRIORITY_META.medium.cls}`}>
                {PRIORITY_META[selectedCase.priority]?.label ?? 'Medium'}
              </span>
              {currentResult && (
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_META[currentResult.status].bg} ${STATUS_META[currentResult.status].color}`}>
                  {STATUS_META[currentResult.status].label}
                </span>
              )}
            </div>
            <h3 className="text-lg font-semibold text-white">{selectedCase.title}</h3>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasPageUrl && (
              <button
                onClick={() => setSplitMode(!splitMode)}
                title={splitMode ? 'Full width mode' : 'Split-screen mode'}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-green-400 bg-gray-700 hover:bg-green-500/10 px-2.5 py-1.5 rounded-lg transition-colors border border-gray-600"
              >
                {splitMode ? <Maximize2 className="w-3.5 h-3.5" /> : <Columns2 className="w-3.5 h-3.5" />}
                {splitMode ? 'Full' : 'Split'}
              </button>
            )}
            {selectedCase.page_url && (
              <a
                href={selectedCase.page_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/15 px-3 py-1.5 rounded-lg transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Instructions & expected result */}
      <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
        {selectedCase.instructions && (
          <div>
            <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Instructions</h4>
            <div
              className="text-sm text-gray-300 leading-relaxed prose prose-sm prose-invert max-w-none [&_ol]:list-decimal [&_ul]:list-disc [&_li]:ml-4"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedCase.instructions) }}
            />
          </div>
        )}
        {selectedCase.expected_result && (
          <div>
            <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Expected Result</h4>
            <div
              className="text-sm text-gray-300 leading-relaxed bg-gray-900 rounded-lg px-4 py-3 border border-gray-700"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedCase.expected_result) }}
            />
          </div>
        )}

        {/* Feedback + Screenshot */}
        <div>
          <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Feedback <span className="font-normal">(required for fail/blocked)</span>
          </h4>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Describe what happened, what you expected... Paste a screenshot with Cmd+V"
            rows={showSplit ? 2 : 3}
            className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500/40 resize-none transition"
          />

          {/* Screenshot area */}
          <div className="mt-2 flex items-start gap-3">
            {screenshot ? (
              <div className="relative group">
                <img src={screenshot.preview} alt="Screenshot" className="h-20 rounded-lg border border-gray-600 object-cover" />
                <button
                  onClick={() => { URL.revokeObjectURL(screenshot.preview); setScreenshot(null) }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleScreenshotFile(f); e.target.value = '' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 bg-gray-700 hover:bg-gray-600 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Upload screenshot
                </button>
                <span className="text-[10px] text-gray-500">or paste with Cmd+V</span>
              </div>
            )}
          </div>
        </div>

        {/* Re-test notice */}
        {currentResult?.needs_retest && (
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
            <RotateCcw className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-orange-500">Re-test Requested</p>
              {currentResult.retest_note && (
                <p className="text-xs text-gray-300 mt-0.5">{currentResult.retest_note}</p>
              )}
            </div>
          </div>
        )}

        {/* Comment thread */}
        <div>
          <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Comments {comments.length > 0 && <span>({comments.length})</span>}
          </h4>
          {commentLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" />
              <span className="text-xs text-gray-500">Loading comments...</span>
            </div>
          ) : (
            <>
              {comments.length > 0 && (
                <div className="space-y-2 mb-2 max-h-[200px] overflow-y-auto">
                  {comments.map(c => (
                    <div key={c.id} className="bg-gray-900 rounded-lg px-3 py-2 border border-gray-700">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-white">{c.author_name}</span>
                        <span className="text-[10px] text-gray-500">{relativeTime(c.created_at)}</span>
                      </div>
                      <p className="text-sm text-gray-300">{c.body}</p>
                    </div>
                  ))}
                </div>
              )}
              {currentResult && currentUser && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={commentBody}
                    onChange={e => setCommentBody(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment() } }}
                    placeholder="Add a comment..."
                    className="flex-1 rounded-lg border border-gray-600 bg-gray-900 px-3 py-1.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500/40 transition"
                  />
                  <button
                    onClick={addComment}
                    disabled={!commentBody.trim() || commentSubmitting}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-500 transition-colors disabled:opacity-50"
                  >
                    <Send className="w-3 h-3" />
                    Comment
                  </button>
                </div>
              )}
              {!currentResult && (
                <p className="text-xs text-gray-500">Submit a test result to enable comments.</p>
              )}
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={() => submitResult('pass')}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            Pass
          </button>
          <button
            onClick={() => submitResult('fail')}
            disabled={submitting || !feedback.trim()}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 ${
              feedback.trim()
                ? 'text-white bg-red-600 hover:bg-red-500 shadow-lg shadow-red-500/20'
                : 'text-red-400 bg-red-500/10 border border-red-500/20 cursor-not-allowed'
            }`}
          >
            <XCircle className="w-4 h-4" />
            Fail
          </button>
          <button
            onClick={() => submitResult('blocked')}
            disabled={submitting || !feedback.trim()}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 ${
              feedback.trim()
                ? 'text-white bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-500/20'
                : 'text-amber-400 bg-amber-500/10 border border-amber-500/20 cursor-not-allowed'
            }`}
          >
            <Ban className="w-4 h-4" />
            Blocked
          </button>
          <button
            onClick={() => submitResult('skipped')}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-gray-400 bg-gray-700 hover:bg-gray-600 border border-gray-600 transition-all disabled:opacity-50"
          >
            <SkipForward className="w-4 h-4" />
            Skip
          </button>
          {submitting && <Loader2 className="w-4 h-4 text-gray-500 animate-spin ml-2" />}
        </div>
      </div>
    </div>
  )

  // Split-screen layout
  if (showSplit) {
    return (
      <div className="bg-gray-800 rounded-xl border border-green-500/20 overflow-hidden">
        <div className="flex flex-col lg:flex-row" style={{ minHeight: '600px' }}>
          <div className="w-full lg:w-[40%] border-b lg:border-b-0 lg:border-r border-gray-700 flex flex-col overflow-hidden">
            {instructionsPanel}
          </div>
          <div className="w-full lg:w-[60%] bg-gray-900 flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 bg-gray-800">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
              <span className="ml-2 text-[11px] text-gray-500 font-mono truncate flex-1">
                {selectedCase.page_url}
              </span>
            </div>
            <iframe
              key={selectedCase.id}
              src={iframeUrl!}
              className="flex-1 w-full border-0"
              style={{ minHeight: '500px' }}
              title={`Test: ${selectedCase.title}`}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
            />
          </div>
        </div>
      </div>
    )
  }

  // Full-width layout
  return (
    <div className="bg-gray-800 rounded-xl border border-green-500/20 overflow-hidden">
      {instructionsPanel}
    </div>
  )
}
