import { useEffect, useState } from 'react'

const KEY = 'catalog-edits'
const EVENT = 'catalog-edits'

type Edits = {
  assets: Record<string, string>
  columns: Record<string, Record<string, string>>
}

function empty(): Edits {
  return { assets: {}, columns: {} }
}

function read(): Edits {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<Edits>
    return { assets: parsed.assets ?? {}, columns: parsed.columns ?? {} }
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
  return { assetDescription, setAssetDescription, columnDescription, setColumnDescription }
}
