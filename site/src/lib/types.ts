export interface ChunkRecord {
  id: string
  documentId: string
  chunkIndex: number
  heading: string
  anchor: string
  content: string
  tokenCount: number
  sourcePath: string
  sourceUrl: string
}

export interface ChunkManifestPart {
  file: string
  size: number
  uncompressedSize: number
  checksum: string
  sequence: number
  chunkCount: number
}

export interface ChunkManifest {
  version: string
  createdAt: string
  totalDocuments: number
  totalChunks: number
  chunkTargetTokens: number
  chunkOverlapTokens: number
  parts: ChunkManifestPart[]
  documents: Array<{ path: string; title: string; anchor: string }>
}

export interface EmbeddingRecord {
  id: string
  vector: number[]
}

export interface EmbeddingManifestPart {
  file: string
  size: number
  uncompressedSize: number
  checksum: string
  sequence: number
  vectorCount: number
}

export interface EmbeddingManifest {
  version: string
  createdAt: string
  model: string
  dimension: number
  chunkVersion: string
  totalVectors: number
  parts: EmbeddingManifestPart[]
}

export interface KnowledgeBase {
  chunks: ChunkRecord[]
  embeddings: EmbeddingRecord[]
  chunkManifest: ChunkManifest
  embeddingManifest: EmbeddingManifest
}

export type LoaderStage = 'idle' | 'loading' | 'ready' | 'error'

export interface LoaderProgress {
  stage: LoaderStage
  label: string
  detail?: string
  percent?: number
  error?: string
}

export type ChatRole = 'user' | 'assistant'

export interface SourceReference {
  id: string
  heading: string
  url: string
  snippet: string
}

export interface ConversationMessage {
  id: string
  role: ChatRole
  content: string
  pending?: boolean
  sources?: SourceReference[]
}
