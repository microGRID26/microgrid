'use client'

export default function MobileError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-dvh bg-gray-950 flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div className="text-red-400 text-4xl mb-4">!</div>
        <h2 className="text-lg font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-sm text-gray-400 mb-6">
          {error.message || 'An unexpected error occurred. Please try again.'}
        </p>
        <button
          onClick={reset}
          className="min-h-[44px] px-6 bg-green-700 text-white font-semibold rounded-xl active:bg-green-600 transition-colors"
        >
          Try Again
        </button>
        <div className="mt-4">
          <a href="/command" className="text-sm text-gray-500 hover:text-gray-400">
            Back to Command Center
          </a>
        </div>
      </div>
    </div>
  )
}
