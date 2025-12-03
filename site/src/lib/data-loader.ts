import { gunzipSync, strFromU8 } from 'fflate'
import type {
  ChunkManifest,
  ChunkRecord,
  EmbeddingManifest,
  EmbeddingRecord,
  KnowledgeBase,
  LoaderProgress,
} from './types'

const resolvePublicPath = (relativePath: string) => {
  const base = import.meta.env.BASE_URL || '/'
  if (relativePath.startsWith('http')) {
    return relativePath
  }
  return `${base.replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}`
}

const fetchJson = async <T>(relativePath: string): Promise<T> => {
  const response = await fetch(resolvePublicPath(relativePath))
  if (!response.ok) {
    throw new Error(`Failed to fetch ${relativePath}: ${response.status}`)
  }
  return response.json() as Promise<T>
}

const fetchCompressed = async (
  relativePath: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Uint8Array> => {
  const response = await fetch(resolvePublicPath(relativePath))
  if (!response.ok) {
    throw new Error(`Failed to fetch ${relativePath}: ${response.status}`)
  }

  const total = Number(response.headers.get('content-length') ?? 0)
  const reader = response.body?.getReader()
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    onProgress?.(buffer.length, total || buffer.length)
    return buffer
  }

  const chunks: Uint8Array[] = []
  let loaded = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (value) {
      chunks.push(value)
      loaded += value.byteLength
      onProgress?.(loaded, total || loaded)
    }
  }

  const merged = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

const fetchCompressedJson = async <T>(
  relativePath: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T> => {
  const data = await fetchCompressed(relativePath, onProgress)
  let payload: Uint8Array
  const isGzip = data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b
  if (isGzip) {
    payload = gunzipSync(data)
  } else {
    payload = data
  }
  const text = strFromU8(payload)
  return JSON.parse(text) as T
}

export const loadKnowledgeBase = async (
  update?: (progress: LoaderProgress) => void,
): Promise<KnowledgeBase> => {
  update?.({ stage: 'loading', label: 'Knowledge Manifest', percent: 0 })
  const chunkManifest = await fetchJson<ChunkManifest>('data/chunks-manifest.json')

  const totalKnowledgeParts = chunkManifest.parts.length || 1
  const chunks: ChunkRecord[] = []

  for (let index = 0; index < chunkManifest.parts.length; index += 1) {
    const part = chunkManifest.parts[index]!
    update?.({
      stage: 'loading',
      label: 'Knowledge',
      detail: `Part ${index + 1} of ${totalKnowledgeParts}`,
      percent: index / totalKnowledgeParts,
    })

    const partData = await fetchCompressedJson<ChunkRecord[]>(part.file, (loaded, total) => {
      update?.({
        stage: 'loading',
        label: 'Knowledge',
        detail: `Part ${index + 1} of ${totalKnowledgeParts}`,
        percent: (index + loaded / (total || part.size)) / totalKnowledgeParts,
      })
    })

    chunks.push(...partData)
  }

  update?.({ stage: 'loading', label: 'Embeddings Manifest', percent: 0 })
  const embeddingManifest = await fetchJson<EmbeddingManifest>('data/chunks-embeddings-manifest.json')
  const embeddings: EmbeddingRecord[] = []
  const totalEmbeddingParts = embeddingManifest.parts.length || 1

  for (let index = 0; index < embeddingManifest.parts.length; index += 1) {
    const part = embeddingManifest.parts[index]!
    update?.({
      stage: 'loading',
      label: 'Embeddings',
      detail: `Part ${index + 1} of ${totalEmbeddingParts}`,
      percent: index / totalEmbeddingParts,
    })

    const partData = await fetchCompressedJson<EmbeddingRecord[]>(part.file, (loaded, total) => {
      update?.({
        stage: 'loading',
        label: 'Embeddings',
        detail: `Part ${index + 1} of ${totalEmbeddingParts}`,
        percent: (index + loaded / (total || part.size)) / totalEmbeddingParts,
      })
    })

    embeddings.push(...partData)
  }

  update?.({ stage: 'ready', label: 'Knowledge Ready', percent: 1 })

  return {
    chunks,
    embeddings,
    chunkManifest,
    embeddingManifest,
  }
}
