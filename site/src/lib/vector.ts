import type { ChunkRecord, EmbeddingRecord, KnowledgeBase, SourceReference } from './types'

export const cosineSimilarity = (a: number[], b: number[]) => {
  if (a.length !== b.length) {
    throw new Error('Vectors must be the same length')
  }

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  if (!normA || !normB) {
    return 0
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export interface RankedChunk extends ChunkRecord {
  score: number
}

export const rankChunks = (
  query: number[],
  knowledge: KnowledgeBase,
  topK = 5,
): RankedChunk[] => {
  const vectorMap = new Map<string, EmbeddingRecord>()
  for (const embedding of knowledge.embeddings) {
    vectorMap.set(embedding.id, embedding)
  }

  const ranked: RankedChunk[] = []
  for (const chunk of knowledge.chunks) {
    const vector = vectorMap.get(chunk.id)
    if (!vector) {
      continue
    }
    const score = cosineSimilarity(query, vector.vector)
    ranked.push({ ...chunk, score })
  }

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

export const buildSourceReferences = (chunks: RankedChunk[], prefix = 'Source') => {
  return chunks.map<SourceReference>((chunk, index) => ({
    id: `${prefix}-${index + 1}`,
    heading: chunk.heading,
    url: chunk.sourceUrl,
    snippet: chunk.content.slice(0, 320).replace(/\s+/g, ' ') + '…',
  }))
}
