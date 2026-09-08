import { useEffect, useState } from 'react'
// Relative, with the extension, so the check script can load this store under plain Node.
import { normalizeTag } from '../data/tags.ts'

const KEY = 'catalog-edits'
const EVENT = 'catalog-edits'

type Edits = {
  assets: Record<string, string>
  columns: Record<string, Record<string, string>>
  /** Keyed by whatever the tags hang off: a service, a tree folder or an asset. */
  tags: Record<string, string[]>
  columnTags: Record<string, Record<string, string[]>>
}

function empty(): Edits {
  return { assets: {}, columns: {}, tags: {}, columnTags: {} }
}

function read(): Edits {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<Edits>
    return {
      assets: parsed.assets ?? {},
      columns: parsed.columns ?? {},
      tags: parsed.tags ?? {},
      columnTags: parsed.columnTags ?? {},
    }
  } catch {
    return empty()
  }
}

function write(edits: Edits) {
  localStorage.setItem(KEY, JSON.stringify(edits))
  window.dispatchEvent(new Event(EVENT))
}

export function assetDescription(id: string, fallback: string): string {
  return read().assets[id] ?? fallback
}

export function setAssetDescription(id: string, value: string) {
  const edits = read()
  edits.assets[id] = value
  write(edits)
}

export function columnDescription(assetId: string, column: string, fallback = ''): string {
  return read().columns[assetId]?.[column] ?? fallback
}

export function setColumnDescription(assetId: string, column: string, value: string) {
  const edits = read()
  edits.columns[assetId] = { ...edits.columns[assetId], [column]: value }
  write(edits)
}

/**
 * Tags of a service, folder or asset. An entity edited down to no tags stores an empty list, which
 * is not nullish and so correctly beats the snapshot's own tags: removing one has to stick.
 */
export function tagsFor(id: string, fallback: string[] = []): string[] {
  return read().tags[id] ?? fallback
}

export function setTags(id: string, tags: string[]) {
  const edits = read()
  edits.tags[id] = clean(tags)
  write(edits)
}

export function columnTagsFor(assetId: string, column: string, fallback: string[] = []): string[] {
  return read().columnTags[assetId]?.[column] ?? fallback
}

export function setColumnTags(assetId: string, column: string, tags: string[]) {
  const edits = read()
  edits.columnTags[assetId] = { ...edits.columnTags[assetId], [column]: clean(tags) }
  write(edits)
}

/** Typed input reaches here, so normalising on the way in is what keeps the store to one shape. */
function clean(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))]
}

export function useCatalogEdits() {
  const [, bump] = useState(0)
  useEffect(() => {
    const onChange = () => bump((n) => n + 1)
    window.addEventListener(EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])
  return {
    assetDescription,
    setAssetDescription,
    columnDescription,
    setColumnDescription,
    tagsFor,
    setTags,
    columnTagsFor,
    setColumnTags,
  }
}
