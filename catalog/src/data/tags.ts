/**
 * The tag vocabulary. Descriptions are the point of it: a tag nobody can define is worse than no
 * tag, so every predefined one says what it means and what to do about it, and the UI shows that
 * on hover. Own tags can be added freely; they simply have no description.
 *
 * Every tag already used in the catalog snapshot is included here, so the tags that ship with the
 * project are explained too rather than reading as unlabelled custom ones.
 *
 * The lookup lives beside the data rather than in `lib/` so the check script can load this file
 * directly, which Node cannot do for anything importing through the `@/` alias.
 */
export type TagGroup = { name: string; tags: Record<string, string> }

export const tagVocabulary: TagGroup[] = [
  {
    name: 'Domain',
    tags: {
      webshop: 'The webshop order flow: customers, products, orders and line items.',
      crm: 'Sales CRM: accounts and the notes account managers keep on them.',
      marketing: 'Campaign data: spend, sends, clicks and the revenue attributed to them.',
      bi: 'Read directly by dashboards and reports, so changes are visible to their audience.',
      catalog: 'Metadata about other assets rather than business data of its own.',
      governance: 'Ownership, policy and audit records used to govern the platform.',
      'control-plane': 'Runs the platform itself. Not business data, but breaking it breaks tooling.',
      app: 'A deployed application rather than a stored dataset.',
      marmot: 'Belongs to the Marmot catalog service and its schema.',
    },
  },
  {
    name: 'Pipeline',
    tags: {
      cdc: 'Captured by change data capture, so every row change is replicated downstream.',
      avro: 'Encoded as Avro against a registry schema; a reader needs that schema to decode it.',
      producer: 'Writes into the pipeline. This is where the data originates, not a copy of it.',
      consumer: 'Reads from the pipeline. If it stalls it falls behind rather than losing data.',
      federation: 'Queried in place through a federating engine, so each read hits the source system.',
      query: 'A query surface rather than storage: what you read through, not where data lives.',
      running: 'Expected to run continuously. If it stops, everything downstream of it goes stale.',
      'source-of-truth': 'The authoritative copy. Correct data here and let the copies follow.',
      derived: 'Built from other assets. Fix problems upstream rather than patching this.',
      'append-only': 'Rows are only ever added, never updated or deleted.',
    },
  },
  {
    name: 'Sensitivity',
    tags: {
      pii: 'Personal data about identifiable people. Handle under the privacy policy and avoid new copies.',
      'special-category': 'GDPR Article 9 data: health, beliefs, biometrics and the like. Needs a stricter legal basis than ordinary personal data.',
      pci: 'Cardholder data, in scope for PCI DSS. Keep it out of logs, exports and screenshots.',
      credentials: 'Passwords, tokens, keys or connection strings. Do not read it, and never copy it anywhere.',
      pseudonymised: 'Direct identifiers swapped for keys. Still personal data: anyone holding the mapping can undo it.',
      anonymised: 'Identifiers removed with no mapping kept, so it can no longer be traced to a person.',
      sensitive: 'Commercially sensitive figures such as revenue, margin or contract terms.',
      'gdpr-erasure': 'Holds rows that must be deleted when a person asks to be forgotten.',
      'data-residency': 'Bound to one region by law or contract. Copying it elsewhere breaks that commitment.',
      'internal-only': 'Must not leave internal systems: no exports, screenshots or shared decks.',
    },
  },
  {
    name: 'Trust',
    tags: {
      verified: 'An owner has confirmed the definition, so the numbers can be quoted as they are.',
      experimental: 'Shape and meaning may change without notice. Do not build on it yet.',
      deprecated: 'Being retired. Migrate off it and add no new readers.',
      'needs-owner': 'Nobody owns it. Find an owner before taking a dependency on it.',
      fact: 'A fact table: one row per event or transaction, with measures meant to be aggregated.',
      'join-key': 'Used to join across systems. Keep its type and format stable.',
    },
  },
  {
    name: 'Operations',
    tags: {
      production: 'Serves live traffic. Changes belong in a maintenance window.',
      'high-throughput': 'Heavy write volume. Expect lag to build quickly if a consumer stalls.',
      'retention-limited': 'Old data is dropped on a schedule. Not an archive, so do not rely on history.',
      costly: 'Expensive to scan or store. Check the cost before querying it broadly.',
      'agent-readable': 'Safe for an AI agent to read unattended.',
      'agent-blocked': 'Agents must not read this: it holds secrets, credentials or raw personal data.',
    },
  },
]

const descriptions: Record<string, string> = Object.assign({}, ...tagVocabulary.map((group) => group.tags))

/** The description of a predefined tag, or undefined for one somebody added themselves. */
export function tagDescription(tag: string): string | undefined {
  return descriptions[tag]
}

export function isPredefinedTag(tag: string): boolean {
  return tag in descriptions
}

/**
 * Tags are matched and stored as plain lowercase words, so what somebody types has to be reduced to
 * that shape before it is saved: otherwise `PII`, `pii ` and `p i i` are three different tags and
 * none of them finds the described one. Returns '' for input with nothing usable left, which the
 * caller treats as "nothing to add".
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 32)
}
