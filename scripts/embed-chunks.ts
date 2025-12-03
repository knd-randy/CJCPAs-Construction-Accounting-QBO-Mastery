import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { pipeline } from '@xenova/transformers'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')
const SITE_PUBLIC_DIR = path.join(REPO_ROOT, 'site', 'public')
const DATA_DIR = path.join(SITE_PUBLIC_DIR, 'data')
const MAX_PART_BYTES = 30 * 1024 * 1024
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

interface ChunkRecord {
  id: string
  content: string
}

interface ChunkManifest {
  version: string
  parts: Array<{ file: string }>
}

interface EmbeddingRecord {
  id: string
  vector: number[]
}

interface ManifestPart {
  file: string
  size: number
  uncompressedSize: number
  checksum: string
  sequence: number
  vectorCount: number
}

interface EmbeddingManifest {
  version: string
  createdAt: string
  model: string
  dimension: number
  chunkVersion: string
  totalVectors: number
  parts: ManifestPart[]
}

const partitionAndWrite = async (records: EmbeddingRecord[], versionHash: string) => {
  await mkdir(DATA_DIR, { recursive: true })
  const parts: ManifestPart[] = []
  let start = 0
  let sequence = 1

  const serializeSlice = (slice: EmbeddingRecord[]) => {
    const json = JSON.stringify(slice)
    const compressed = gzipSync(Buffer.from(json, 'utf-8'))
    return {
      compressed,
      uncompressedSize: Buffer.byteLength(json, 'utf-8'),
    }
  }

  while (start < records.length) {
    let end = Math.min(start + 400, records.length)
    let { compressed, uncompressedSize } = serializeSlice(records.slice(start, end))

    while (compressed.length > MAX_PART_BYTES && end - start > 1) {
      const span = end - start
      end = start + Math.max(1, Math.floor(span / 2))
      ;({ compressed, uncompressedSize } = serializeSlice(records.slice(start, end)))
    }

    if (compressed.length > MAX_PART_BYTES) {
      throw new Error('Unable to compress embeddings under 30MB limit')
    }

    const fileName = `embeddings-${versionHash}-part-${String(sequence).padStart(2, '0')}.json.gz`
    await writeFile(path.join(DATA_DIR, fileName), compressed)
    parts.push({
      file: path.join('data', fileName).replace(/\\/g, '/'),
      size: compressed.length,
      uncompressedSize,
      checksum: createHash('sha256').update(compressed).digest('hex'),
      sequence,
      vectorCount: end - start,
    })

    start = end
    sequence += 1
  }

  return parts
}

async function loadChunks(): Promise<{ manifest: ChunkManifest; chunks: ChunkRecord[] }> {
  const manifestPath = path.join(DATA_DIR, 'chunks-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as ChunkManifest
  const chunks: ChunkRecord[] = []

  for (const part of manifest.parts) {
    const partPath = path.join(SITE_PUBLIC_DIR, part.file)
    const buffer = await readFile(partPath)
    const payload = gunzipSync(buffer).toString('utf-8')
    const slice = JSON.parse(payload) as ChunkRecord[]
    chunks.push(...slice)
  }

  return { manifest, chunks }
}

async function main() {
  const { manifest: chunkManifest, chunks } = await loadChunks()
  if (!chunks.length) {
    console.warn('No chunks available. Did you run build-knowledge first?')
    return
  }

  console.log(`Embedding ${chunks.length} chunks with ${MODEL_ID}`)
  const embedder = await pipeline('feature-extraction', MODEL_ID)
  const embeddings: EmbeddingRecord[] = []
  let dimension = 0

  for (const chunk of chunks) {
    const output = await embedder(chunk.content, { pooling: 'mean', normalize: true })
    const vector = Array.from(output.data) as number[]
    dimension = dimension || vector.length
    embeddings.push({ id: chunk.id, vector })
  }

  const versionHash = createHash('sha1')
    .update(`${chunkManifest.version}-${MODEL_ID}`)
    .digest('hex')
    .slice(0, 12)

  const parts = await partitionAndWrite(embeddings, versionHash)

  const embeddingManifest: EmbeddingManifest = {
    version: versionHash,
    createdAt: new Date().toISOString(),
    model: MODEL_ID,
    dimension,
    chunkVersion: chunkManifest.version,
    totalVectors: embeddings.length,
    parts,
  }

  await writeFile(
    path.join(DATA_DIR, 'chunks-embeddings-manifest.json'),
    JSON.stringify(embeddingManifest, null, 2),
    'utf-8',
  )

  console.log(`Stored ${embeddings.length} embeddings across ${parts.length} part(s).`)
}

main().catch((error) => {
  console.error('Failed to build embeddings:', error)
  process.exitCode = 1
})
