import type { FormEvent } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { loadKnowledgeBase } from './lib/data-loader'
import type { ConversationMessage, KnowledgeBase, LoaderProgress } from './lib/types'
import { useConversation } from './hooks/useConversation'

const formatPercent = (percent?: number) => {
  if (percent == null) {
    return null
  }
  const clamped = Math.max(0, Math.min(1, percent))
  return Math.round(clamped * 100)
}

interface ProgressCardProps {
  title: string
  progress: LoaderProgress | null
}

const ProgressCard = ({ title, progress }: ProgressCardProps) => {
  const percentValue = progress?.percent ?? (progress?.stage === 'ready' ? 1 : undefined)
  const percent = formatPercent(percentValue)
  const barWidth = percent != null ? `${percent}%` : '0%'
  const barColor =
    progress?.stage === 'error'
      ? 'bg-rose-500'
      : progress?.stage === 'ready'
        ? 'bg-emerald-400'
        : 'bg-brand-500'

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-xs text-slate-400">
        {progress?.detail || progress?.label || 'Idle'}
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${barColor}`} style={{ width: barWidth }} />
      </div>
      {percent != null ? (
        <p className="mt-2 text-xs text-white/70">{percent}%</p>
      ) : (
        <p className="mt-2 text-xs text-white/50">Waiting</p>
      )}
      {progress?.error ? (
        <p className="mt-2 text-xs text-rose-300">{progress.error}</p>
      ) : null}
    </div>
  )
}

const placeholderMessage: ConversationMessage = {
  id: 'placeholder-message',
  role: 'assistant',
  content: 'Load the knowledge base to begin chatting.',
}

function App() {
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase | null>(null)
  const [loaderProgress, setLoaderProgress] = useState<LoaderProgress | null>(null)
  const [modelProgress, setModelProgress] = useState<LoaderProgress | null>(null)
  const [kbError, setKbError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false)

  const handleModelProgress = useCallback((progress: LoaderProgress) => {
    setModelProgress(progress)
  }, [])

  const { messages, status, error, sendMessage, resetConversation, isReady } = useConversation({
    knowledgeBase,
    onModelProgress: handleModelProgress,
  })

  const knowledgeStats = useMemo(() => {
    if (!knowledgeBase) {
      return null
    }
    return {
      version: knowledgeBase.chunkManifest.version,
      documents: knowledgeBase.chunkManifest.totalDocuments,
      chunks: knowledgeBase.chunkManifest.totalChunks,
      vectors: knowledgeBase.embeddingManifest.totalVectors,
    }
  }, [knowledgeBase])

  const handleLoadKnowledge = useCallback(async () => {
    if (isLoadingKnowledge) {
      return
    }
    setKbError(null)
    setLoaderProgress({ stage: 'loading', label: 'Preparing download', percent: 0 })
    setIsLoadingKnowledge(true)
    try {
      const data = await loadKnowledgeBase((progress) => setLoaderProgress(progress))
      setKnowledgeBase(data)
      resetConversation()
      setLoaderProgress({ stage: 'ready', label: 'Knowledge Ready', percent: 1 })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to download the knowledge base.'
      setKbError(message)
      setLoaderProgress({ stage: 'error', label: 'Knowledge Error', error: message })
    } finally {
      setIsLoadingKnowledge(false)
    }
  }, [isLoadingKnowledge, resetConversation])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const value = prompt.trim()
      if (!value) {
        return
      }
      setPrompt('')
      await sendMessage(value)
    },
    [prompt, sendMessage],
  )

  const disableChat = !isReady || status === 'loading' || status === 'responding'
  const displayMessages = messages.length ? messages : [placeholderMessage]

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-brand-400">CJCPAs</p>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">Construction Accounting CoPilot</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Load the compressed knowledge base, spin up WebLLM locally, and chat with a
              retrieval-grounded CPA assistant that cites every answer.
            </p>
          </div>
          <a
            className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:border-white/60"
            href="https://github.com/knd-randy/CJCPAs-Construction-Accounting-QBO-Mastery/tree/Construction-Accounting-QBO-CoPilot"
            target="_blank"
            rel="noreferrer"
          >
            View Repository
          </a>
        </header>

        <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
          <aside className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">
                Dataset Loader
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">Option A Knowledge</h2>
              <p className="mt-2 text-sm text-slate-300">
                Downloads run sequential gzip parts (≤30&nbsp;MB each) with inline progress.
                Reload anytime to pick up new documentation assets.
              </p>
              <button
                className="mt-4 w-full rounded-2xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:bg-white/20"
                type="button"
                disabled={isLoadingKnowledge}
                onClick={handleLoadKnowledge}
              >
                {isLoadingKnowledge ? 'Downloading…' : knowledgeBase ? 'Reload knowledge' : 'Load knowledge'}
              </button>
              {kbError ? (
                <p className="mt-3 text-sm text-rose-300">{kbError}</p>
              ) : null}
              {knowledgeStats ? (
                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Documents</dt>
                    <dd className="text-lg font-semibold text-white">{knowledgeStats.documents}</dd>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Chunks</dt>
                    <dd className="text-lg font-semibold text-white">{knowledgeStats.chunks}</dd>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Vectors</dt>
                    <dd className="text-lg font-semibold text-white">{knowledgeStats.vectors}</dd>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Version</dt>
                    <dd className="text-sm font-medium text-white">{knowledgeStats.version}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-5 text-sm text-slate-400">Stats unlock once the dataset loads.</p>
              )}
            </section>

            <section className="space-y-4">
              <ProgressCard title="Knowledge Dataset" progress={loaderProgress} />
              <ProgressCard title="WebLLM Engine" progress={modelProgress} />
            </section>
          </aside>

          <section className="flex flex-col rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-brand-950/30 p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-brand-200">Conversation</p>
                <h2 className="text-2xl font-semibold text-white">CPA Retrieval Chat</h2>
              </div>
              <div className="flex items-center gap-3 text-xs text-white/70">
                <span
                  className={
                    isReady ? 'inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-200' : 'inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1'
                  }
                >
                  <span className={`h-2 w-2 rounded-full ${isReady ? 'bg-emerald-300' : 'bg-slate-400'}`} />
                  {isReady ? 'Knowledge Ready' : 'Awaiting dataset'}
                </span>
                <span
                  className={
                    status === 'responding'
                      ? 'inline-flex items-center gap-2 rounded-full bg-brand-500/20 px-3 py-1 text-brand-100'
                      : 'inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1'
                  }
                >
                  <span className={`h-2 w-2 rounded-full ${status === 'responding' ? 'bg-brand-300' : 'bg-slate-400'}`} />
                  {status === 'responding' ? 'Streaming response' : 'Idle'}
                </span>
                <button
                  className="rounded-full border border-white/20 px-3 py-1 text-white transition hover:border-white/50"
                  type="button"
                  onClick={resetConversation}
                  disabled={!messages.length}
                >
                  Reset chat
                </button>
              </div>
            </div>

            <div className="mt-4 flex-1 overflow-hidden">
              <div className="h-full space-y-4 overflow-y-auto pr-2">
                {displayMessages.map((message, index) => (
                  <article
                    key={message.id ?? `placeholder-${index}`}
                    className={
                      message.role === 'assistant'
                        ? 'ml-auto max-w-2xl rounded-2xl border border-brand-500/20 bg-brand-500/10 p-4'
                        : message.role === 'user'
                          ? 'max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-4'
                          : 'max-w-2xl rounded-2xl border border-dashed border-white/10 bg-transparent p-4 text-slate-400'
                    }
                  >
                    <p className="text-xs uppercase tracking-wide text-white/60">
                      {message.role === 'assistant' ? 'Assistant' : message.role === 'user' ? 'User' : 'System'}
                    </p>
                    <p className="mt-2 text-sm text-white/90">
                      {message.content || (message.pending ? '…' : '')}
                    </p>
                    {message.role === 'assistant' && message.sources?.length ? (
                      <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Sources</p>
                        <ol className="space-y-2 text-sm">
                          {message.sources.map((source, sourceIndex) => (
                            <li key={source.id}>
                              <a
                                className="font-medium text-brand-200 underline-offset-2 hover:underline"
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                [#{sourceIndex + 1}] {source.heading}
                              </a>
                              <p className="text-xs text-slate-400">{source.snippet}</p>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>

            {(error || kbError) && (
              <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                {kbError ? <p>Loader: {kbError}</p> : null}
                {error ? <p>Assistant: {error}</p> : null}
              </div>
            )}

            <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
              <textarea
                className="min-h-[96px] w-full resize-none rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-white placeholder:text-slate-500 focus:border-brand-400 focus:outline-none"
                placeholder={
                  isReady
                    ? 'Ask about retainage workflow, progress billings, WIP schedules…'
                    : 'Load the knowledge base before chatting.'
                }
                disabled={!isReady}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Answers stream from Llama&nbsp;3.1 8B running client-side via WebLLM with Option A retrieval.
                </p>
                <button
                  className="inline-flex items-center justify-center rounded-full bg-brand-500 px-6 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:bg-white/20"
                  type="submit"
                  disabled={disableChat}
                >
                  {status === 'responding' ? 'Streaming…' : 'Send message'}
                </button>
              </div>
            </form>
          </section>
        </div>

        <footer className="border-t border-white/10 pt-4 text-center text-xs text-slate-500">
          Option A ingestion · WebLLM retrieval · December 2025 build
        </footer>
      </div>
    </div>
  )
}

export default App
