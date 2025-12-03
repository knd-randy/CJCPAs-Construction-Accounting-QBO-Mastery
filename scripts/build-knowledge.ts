import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fg from 'fast-glob'
import GithubSlugger from 'github-slugger'
import { toString } from 'mdast-util-to-string'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Heading, Root } from 'mdast'
import stripMarkdown from 'strip-markdown'
import { gzipSync } from 'node:zlib'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')
const SITE_PUBLIC_DIR = path.join(REPO_ROOT, 'site', 'public')
const DATA_DIR = path.join(SITE_PUBLIC_DIR, 'data')
const MAX_PART_BYTES = 30 * 1024 * 1024 // 30MB
const CHUNK_TARGET_TOKENS = 1200
const CHUNK_OVERLAP_TOKENS = 200
const DEFAULT_BRANCH = 'main'
const REPO_SLUG = 'knd-randy/CJCPAs-Construction-Accounting-QBO-Mastery'

const mdProcessor = unified().use(remarkParse)
const plainProcessor = unified().use(remarkParse).use(stripMarkdown)

interface Section {
  anchor: string
  heading: string
  text: string
}

interface ChunkRecord {
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

interface ManifestPart {
  file: string
  size: number
  uncompressedSize: number
  checksum: string
  sequence: number
  chunkCount: number
}

interface Manifest {
  version: string
  createdAt: string
  totalDocuments: number
  totalChunks: number
  chunkTargetTokens: number
  chunkOverlapTokens: number
  parts: ManifestPart[]
  documents: Array<{ path: string; title: string; anchor: string }>
}

const tokenise = (text: string) => text.split(/\s+/).filter(Boolean)

const slugifyHeading = (slugger: GithubSlugger, value: string, fallback: string) => {
  const trimmed = value.trim() || fallback
  return {
    heading: trimmed,
    anchor: slugger.slug(trimmed || fallback),
  }
}

const sectionise = (markdown: string, relativePath: string): Section[] => {
  const tree = mdProcessor.parse(markdown) as Root
  const slugger = new GithubSlugger()
  const fallbackTitle = path.basename(relativePath, path.extname(relativePath))
  let currentHeading = fallbackTitle
  let currentAnchor = slugger.slug(currentHeading)
  const sections: Section[] = []

  visit(tree, (node: any) => {
    if ((node as Heading).type === 'heading') {
      const result = slugifyHeading(slugger, toString(node), fallbackTitle)
      currentHeading = result.heading
      currentAnchor = result.anchor
      return
    }

    if ('value' in node || 'children' in node) {
      let text: string
      if ('value' in node && typeof node.value === 'string') {
        text = node.value
      } else {
        text = toString(node as never)
      }

      const plain = text.replace(/\s+/g, ' ').trim()
      if (!plain) {
        return
      }

      sections.push({
        anchor: currentAnchor,
        heading: currentHeading,
        text: plain,
      })
    }
  })

  if (!sections.length) {
    const stripped = plainProcessor.processSync(markdown)
    const fallbackText = String(stripped).replace(/\s+/g, ' ').trim()
    if (fallbackText) {
      sections.push({
        anchor: currentAnchor,
        heading: currentHeading,
        text: fallbackText,
      })
    }
  }

  return sections
}

const buildChunks = (sections: Section[], fileMeta: { path: string; title: string }) => {
  const chunks: ChunkRecord[] = []
  let buffer: Section[] = []
  let bufferTokens = 0
  let chunkIndex = 0

  const flushChunk = (force = false) => {
    if (!buffer.length) {
      return
    }
    if (!force && bufferTokens < Math.min(CHUNK_TARGET_TOKENS * 0.5, CHUNK_TARGET_TOKENS)) {
      return
    }

    const content = buffer.map((section) => section.text).join('\n\n')
    const tokens = tokenise(content)
    if (!tokens.length) {
      buffer = []
      bufferTokens = 0
      return
    }

    const heading = buffer[0]?.heading || fileMeta.title
    const anchor = buffer[0]?.anchor || fileMeta.title
    const chunkId = `${fileMeta.path}::${chunkIndex}`
    const sourceUrl = `https://github.com/${REPO_SLUG}/blob/${DEFAULT_BRANCH}/${fileMeta.path}#${anchor}`

    chunks.push({
      id: chunkId,
      documentId: fileMeta.path,
      chunkIndex,
      heading,
      anchor,
      content,
      tokenCount: tokens.length,
      sourcePath: fileMeta.path,
      sourceUrl,
    })

    chunkIndex += 1

    const overlapTokens = tokens.slice(-CHUNK_OVERLAP_TOKENS)
    buffer = overlapTokens.length
      ? [{ anchor, heading, text: overlapTokens.join(' ') }]
      : []
    bufferTokens = overlapTokens.length
  }

  for (const section of sections) {
    const tokens = tokenise(section.text)
    if (!tokens.length) {
      continue
    }

    if (tokens.length > CHUNK_TARGET_TOKENS * 1.5) {
      let start = 0
      while (start < tokens.length) {
        const subset = tokens.slice(start, start + CHUNK_TARGET_TOKENS)
        buffer.push({ anchor: section.anchor, heading: section.heading, text: subset.join(' ') })
        bufferTokens += subset.length
        flushChunk()
        start += CHUNK_TARGET_TOKENS - CHUNK_OVERLAP_TOKENS
      }
      continue
    }

    buffer.push(section)
    bufferTokens += tokens.length

    if (bufferTokens >= CHUNK_TARGET_TOKENS) {
      flushChunk()
    }
  }

  flushChunk(true)
  return chunks
}

const writeChunkParts = async (chunks: ChunkRecord[], versionHash: string) => {
  await mkdir(DATA_DIR, { recursive: true })
  const parts: ManifestPart[] = []
  let start = 0
  let sequence = 1

  const serializeSlice = (slice: ChunkRecord[]) => {
    const json = JSON.stringify(slice)
    const compressed = gzipSync(Buffer.from(json, 'utf-8'))
    return {
      compressed,
      uncompressedSize: Buffer.byteLength(json, 'utf-8'),
    }
  }

  while (start < chunks.length) {
    let end = Math.min(start + 400, chunks.length)
    let { compressed, uncompressedSize } = serializeSlice(chunks.slice(start, end))

    while (compressed.length > MAX_PART_BYTES && end - start > 1) {
      const span = end - start
      end = start + Math.max(1, Math.floor(span / 2))
      ;({ compressed, uncompressedSize } = serializeSlice(chunks.slice(start, end)))
    }

    if (compressed.length > MAX_PART_BYTES) {
      throw new Error(`Unable to keep compressed chunk part under ${MAX_PART_BYTES} bytes`)
    }

    const fileName = `chunks-${versionHash}-part-${String(sequence).padStart(2, '0')}.json.gz`
    await writeFile(path.join(DATA_DIR, fileName), compressed)
    parts.push({
      file: path.join('data', fileName).replace(/\\/g, '/'),
      size: compressed.length,
      uncompressedSize,
      checksum: createHash('sha256').update(compressed).digest('hex'),
      sequence,
      chunkCount: end - start,
    })

    start = end
    sequence += 1
  }

  return parts
}

const resetDataDir = async () => {
  try {
    const stats = await stat(DATA_DIR)
    if (stats.isDirectory()) {
      await rm(DATA_DIR, { recursive: true, force: true })
    }
  } catch (_) {
    // directory does not exist
  }
}

async function main() {
  await resetDataDir()
  await mkdir(DATA_DIR, { recursive: true })

  const files = await fg(['docs/**/*.md', 'templates/**/*.{md,csv}'], {
    cwd: REPO_ROOT,
    dot: false,
  })

  const allChunks: ChunkRecord[] = []
  const documents: Manifest['documents'] = []

  for (const relativePath of files) {
    const absolutePath = path.join(REPO_ROOT, relativePath)
    const raw = await readFile(absolutePath, 'utf-8')
    const sections = sectionise(raw, relativePath)
    if (!sections.length) {
      continue
    }

    const title = sections[0]?.heading || path.basename(relativePath)
    const docChunks = buildChunks(sections, { path: relativePath.replace(/\\/g, '/'), title })
    if (!docChunks.length) {
      continue
    }

    allChunks.push(...docChunks)
    documents.push({ path: relativePath.replace(/\\/g, '/'), title, anchor: docChunks[0].anchor })
  }

  const versionHash = createHash('sha1')
    .update(JSON.stringify(allChunks))
    .digest('hex')
    .slice(0, 12)
  const parts = await writeChunkParts(allChunks, versionHash)

  const manifest: Manifest = {
    version: versionHash,
    createdAt: new Date().toISOString(),
    totalDocuments: documents.length,
    totalChunks: allChunks.length,
    chunkTargetTokens: CHUNK_TARGET_TOKENS,
    chunkOverlapTokens: CHUNK_OVERLAP_TOKENS,
    parts,
    documents,
  }

  await writeFile(
    path.join(DATA_DIR, 'chunks-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  )

  console.log(`Generated ${allChunks.length} chunks across ${documents.length} documents.`)
  console.log(`Version: ${versionHash}`)
}

main().catch((error) => {
  console.error('Failed to build knowledge base:', error)
  process.exitCode = 1
})
