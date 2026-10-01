import { useEffect, useState } from 'react'
// Relative, with the extension, so the check script can load this store under plain Node.
import { normalizeTag } from '../data/tags.ts'
import type { Owner } from '../types.ts'

const KEY = 'catalog-edits'
const EVENT = 'catalog-edits'

/**
 * Who wrote a piece of context, when, and whether anybody has agreed to it.
 *
 * Marko Bocevski's condition for machine-written context was unambiguous — "opt opt opt in… check
 * check check boxes" — and the governance failure he described is the one where "somebody does that
 * and doesn't pay attention to it and just says, 'Oh, this is great.'" So a generated sentence
 * arrives as `suggested` and stays that way until a person accepts it. Nothing becomes fact because
 * nobody objected.
 *
 * A human typing a description is its own acceptance: they are the author and the reviewer in the
 * same keystroke, so their edits are stored `accepted` rather than pretending at a workflow.
 */
export type ReviewState = 'suggested' | 'accepted' | 'rejected'

export interface Provenance {
  author: string
  at: string
  state: ReviewState
  /** Every source behind an assembled sentence, so an aggregate can be checked rather than trusted. */
  sources?: string[]
}

type Edits = {
  assets: Record<string, string>
  columns: Record<string, Record<string, string>>
  /** Keyed by whatever the tags hang off: a service, a tree folder or an asset. */
  tags: Record<string, string[]>
  columnTags: Record<string, Record<string, string[]>>
  /** Keyed the same way as tags, so a schema can own what is under it. */
  owners: Record<string, Owner[]>
  /**
   * Keyed by `provenanceKey`, which is the thing edited rather than the entity: a table's
   * description and its `status` column's note are reviewed separately because they are written
   * separately.
   */
  provenance: Record<string, Provenance>
  /**
   * Scopes where somebody has agreed that context may be generated, and who agreed. Generation is
   * refused outside these, which is what makes it opt-in rather than opt-out with extra steps.
   */
  grants: Record<string, { by: string; at: string }>
}

function empty(): Edits {
  return { assets: {}, columns: {}, tags: {}, columnTags: {}, owners: {}, provenance: {}, grants: {} }
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
      owners: parsed.owners ?? {},
      provenance: parsed.provenance ?? {},
      grants: parsed.grants ?? {},
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

export function setAssetDescription(id: string, value: string, author = 'you') {
  const edits = read()
  edits.assets[id] = value
  stamp(edits, provenanceKey(id), { author, at: new Date().toISOString(), state: 'accepted' })
  write(edits)
}

export function columnDescription(assetId: string, column: string, fallback = ''): string {
  return read().columns[assetId]?.[column] ?? fallback
}

export function setColumnDescription(assetId: string, column: string, value: string, author = 'you') {
  const edits = read()
  edits.columns[assetId] = { ...edits.columns[assetId], [column]: value }
  stamp(edits, provenanceKey(assetId, column), { author, at: new Date().toISOString(), state: 'accepted' })
  write(edits)
}

/**
 * Tags of a service, folder or asset. An entity edited down to no tags stores an empty list, which
 * is not nullish and so correctly beats the snapshot's own tags: removing one has to stick.
 */
export function tagsFor(id: string, fallback: string[] = []): string[] {
  return read().tags[id] ?? fallback
}

export function setTags(id: string, tags: string[], author = 'you') {
  const edits = read()
  edits.tags[id] = clean(tags)
  stamp(edits, provenanceKey(id, 'tags'), { author, at: new Date().toISOString(), state: 'accepted' })
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

/**
 * Owners set directly on this service, folder or asset. Inheritance is deliberately not applied
 * here — see `resolveOwners` in lib/catalog, which walks the tree. This store answers the narrower
 * question "what did somebody put on this exact thing", which is what the editor needs to save.
 */
export function ownersFor(id: string): Owner[] {
  return read().owners[id] ?? []
}

export function setOwners(id: string, owners: Owner[]) {
  const edits = read()
  edits.owners[id] = cleanOwners(owners)
  write(edits)
}

/**
 * What was edited, as one string. `pg.public.orders` is the table's description, and
 * `pg.public.orders#status` the note on one of its columns: separately written, separately
 * reviewed, separately rejected.
 */
export function provenanceKey(id: string, column?: string): string {
  return column ? `${id}#${column}` : id
}

export function provenanceOf(id: string, column?: string): Provenance | undefined {
  return read().provenance[provenanceKey(id, column)]
}

/** A person typing is the author and the reviewer at once, so their own edits arrive accepted. */
function stamp(edits: Edits, key: string, provenance: Provenance) {
  edits.provenance[key] = provenance
}

/**
 * Context written by something rather than somebody. Stored exactly like a human's edit — so the
 * whole UI renders it without knowing the difference — and marked `suggested`, which is what every
 * reader and the emitted documents key off.
 *
 * Refused outside a granted scope. That refusal is the feature: without it "opt-in" means a
 * checkbox somebody ticked once for everything.
 */
export function suggest(
  id: string,
  value: string,
  by: { author: string; sources: string[] },
  column?: string,
): { ok: boolean; because: string } {
  const edits = read()
  const scope = id.split('.')[0]
  if (!edits.grants[scope] && !edits.grants['*']) {
    return {
      ok: false,
      because: `Nobody has agreed that context may be generated for ${scope}. Grant it first, and the grant is recorded against whoever gave it.`,
    }
  }

  if (column) edits.columns[id] = { ...edits.columns[id], [column]: value }
  else edits.assets[id] = value
  stamp(edits, provenanceKey(id, column), {
    author: by.author,
    at: new Date().toISOString(),
    state: 'suggested',
    sources: by.sources,
  })
  write(edits)
  return { ok: true, because: 'Stored as a suggestion. It counts for nothing until somebody accepts it.' }
}

export function review(id: string, state: 'accepted' | 'rejected', column?: string) {
  const edits = read()
  const key = provenanceKey(id, column)
  const existing = edits.provenance[key]
  if (!existing) return

  if (state === 'rejected') {
    // Rejection removes the text as well as the verdict. Leaving a rejected sentence in the store
    // is how a rejected sentence ends up on a page: something eventually reads the value and not
    // the state, and the reader cannot tell that anybody disagreed.
    if (column) delete edits.columns[id]?.[column]
    else delete edits.assets[id]
    delete edits.provenance[key]
  } else {
    edits.provenance[key] = { ...existing, state, author: existing.author, at: existing.at }
  }
  write(edits)
}

/** Scopes where generation is permitted, and who permitted each. */
export function grantsHeld(): Record<string, { by: string; at: string }> {
  return read().grants
}

export function grantGeneration(scope: string, by: string) {
  const edits = read()
  edits.grants[scope] = { by, at: new Date().toISOString() }
  write(edits)
}

export function revokeGeneration(scope: string) {
  const edits = read()
  delete edits.grants[scope]
  write(edits)
}

/** Typed input reaches here, so normalising on the way in is what keeps the store to one shape. */
function clean(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))]
}

/**
 * Names keep their capitals, unlike tags: "Payments Team" is a name rather than an identifier. Only
 * the duplicate check is case-insensitive, so the same team typed two ways lands once.
 */
function cleanOwners(owners: Owner[]): Owner[] {
  const seen = new Set<string>()
  return owners.flatMap((owner) => {
    const name = owner.name.trim().replace(/\s+/g, ' ')
    if (!name || seen.has(name.toLowerCase())) return []
    seen.add(name.toLowerCase())
    return [{ name, kind: owner.kind }]
  })
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
    ownersFor,
    setOwners,
    provenanceOf,
    suggest,
    review,
    grantsHeld,
    grantGeneration,
    revokeGeneration,
  }
}
