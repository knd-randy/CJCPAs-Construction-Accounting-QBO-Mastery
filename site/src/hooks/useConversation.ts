import { useCallback, useRef, useState } from 'react'
import { pipeline as createPipeline } from '@xenova/transformers'
import { CreateMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm'
import type { MLCEngine, ChatCompletionMessageParam } from '@mlc-ai/web-llm'
import type {
  ConversationMessage,
  KnowledgeBase,
  LoaderProgress,
  SourceReference,
} from '../lib/types'
import { buildSourceReferences, rankChunks } from '../lib/vector'

const PROD_MODEL_ID = 'Llama-3.1-8B-Instruct-q4f16_1-MLC'
const DEV_MODEL_ID = 'Llama-3.2-3B-Instruct-q4f16_1-MLC'
const WEBLLM_MODEL =
  (import.meta.env.VITE_WEBLLM_MODEL as string | undefined) ||
  (import.meta.env.DEV ? DEV_MODEL_ID : PROD_MODEL_ID)
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

const modelRecord = prebuiltAppConfig.model_list.find((record) => record.model_id === WEBLLM_MODEL)
if (!modelRecord) {
  throw new Error(`WebLLM prebuilt config missing model: ${WEBLLM_MODEL}`)
}

const appConfig = {
  ...prebuiltAppConfig,
  useIndexedDBCache: true,
  model_list: [modelRecord],
}

interface ConversationOptions {
  knowledgeBase: KnowledgeBase | null
  onModelProgress?: (progress: LoaderProgress) => void
}

export const useConversation = ({ knowledgeBase, onModelProgress }: ConversationOptions) => {
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'responding' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const engineRef = useRef<MLCEngine | null>(null)
  const embedderRef = useRef<any>(null)
  const historyRef = useRef<ChatCompletionMessageParam[]>([])

  const ensureEngine = useCallback(async () => {
    if (engineRef.current) {
      return engineRef.current
    }
    onModelProgress?.({ stage: 'loading', label: 'Loading WebLLM', percent: 0 })
    const engine = await CreateMLCEngine(WEBLLM_MODEL, {
      appConfig,
      initProgressCallback: (info) => {
        onModelProgress?.({
          stage: 'loading',
          label: 'Loading WebLLM',
          detail: info.text,
          percent: info.progress,
        })
      },
    })
    engineRef.current = engine
    onModelProgress?.({ stage: 'ready', label: 'WebLLM Ready', percent: 1 })
    return engine
  }, [onModelProgress])

  const ensureEmbedder = useCallback(async () => {
    if (embedderRef.current) {
      return embedderRef.current
    }
    const embedder = await createPipeline('feature-extraction', EMBEDDING_MODEL)
    embedderRef.current = embedder
    return embedder
  }, [])

  const embedQuery = useCallback(async (prompt: string) => {
    const embedder = await ensureEmbedder()
    const output = await embedder(prompt, { pooling: 'mean', normalize: true })
    return Array.from(output.data) as number[]
  }, [ensureEmbedder])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) {
        return
      }
      if (!knowledgeBase) {
        setError('Load the knowledge base before chatting.')
        return
      }

      setError(null)
      setStatus('loading')

      const userMessage: ConversationMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: content.trim(),
      }
      setMessages((prev) => [...prev, userMessage])

      try {
        const queryVector = await embedQuery(content)
        const topChunks = rankChunks(queryVector, knowledgeBase, 5)
        const sources: SourceReference[] = buildSourceReferences(topChunks)
        const context = topChunks
          .map((chunk, index) => `[#${index + 1}] ${chunk.heading}\n${chunk.content}`)
          .join('\n\n')

        const systemPrompt = `You are an expert CPA for construction companies using QuickBooks Online. Use only the provided context. Cite supporting passages using [#] markers that correspond to the numbered list below. If the context does not answer the user, say so.`

        const conversationMessages: ChatCompletionMessageParam[] = [
          ...historyRef.current,
          { role: 'system', content: `${systemPrompt}\n\nContext:\n${context}` },
          { role: 'user', content },
        ]

        const engine = await ensureEngine()
        setStatus('responding')

        const completion = await engine.chat.completions.create({
          messages: conversationMessages,
          temperature: 0.2,
          stream: true,
        })

        const assistantId = crypto.randomUUID()
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: '',
            pending: true,
            sources,
          },
        ])

        let assistantContent = ''
        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta?.content ?? ''
          if (!delta) {
            continue
          }
          assistantContent += delta
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? { ...message, content: assistantContent }
                : message,
            ),
          )
        }

        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: assistantContent.trim(), pending: false }
              : message,
          ),
        )

        historyRef.current = [
          ...historyRef.current,
          { role: 'user', content },
          { role: 'assistant', content: assistantContent.trim() },
        ]
        setStatus('idle')
      } catch (err) {
        console.error(err)
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Unknown error generating response.')
      }
    },
    [embedQuery, ensureEngine, knowledgeBase],
  )

  const resetConversation = useCallback(() => {
    setMessages([])
    historyRef.current = []
    setError(null)
    setStatus('idle')
  }, [])

  return {
    messages,
    status,
    error,
    sendMessage,
    resetConversation,
    isReady: Boolean(knowledgeBase),
  }
}
