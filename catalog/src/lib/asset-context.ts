// One document per dataset, so an investigation is one fetch rather than five.
//
// Muralidhar Basani built this twice — once internally, once as the open-source Stream Lens —
// because "with one API what I have it would consolidate everything", and because a single topic
// can carry hundreds of consumer groups whose configuration is invisible in the console and the
// CLI. Gemma Minihan described the same shape as a platform requirement from the other direction:
// "rather than doing five API calls to try to aggregate information to make a decision, the
// decision could be made on one call".
//
// The service document already works this way and is the model. This is the same idea one level
// down, at the level people actually investigate, which for Kafka is the topic.
//
// Two rules, both learned from the service document. Every fact carries where it came from and
// when, so a claim can be re-checked rather than believed. And `origin` separates what was read
// from a tool from what somebody wrote, because they fail differently: a captured fact goes stale,
// an authored one goes wrong.
import { catalog } from '../data/catalog.ts'
import { topicSerialization } from '../data/operations.ts'
import { tagDescription } from '../data/tags.ts'
import type { Asset, Column, Owner, TopicSerialization } from '../types.ts'
import { policyFor, type ResolvedPolicy } from './agent-context.ts'
import { costOf, deletionReview, type AssetCost, type DeletionReview } from './asset-review.ts'
import { assetById, resolveOwners, serviceById, typeLabel } from './catalog.ts'
import { assetDescription, columnDescription, provenanceOf, tagsFor, type Provenance } from './catalog-edits.ts'
import { diagnose, type Diagnosis } from './diagnose.ts'
import { lagOf, topicHealthFor } from './operations.ts'

/** Where a fact came from, because a reading that is three days old and a sentence somebody wrote
 * last year are both "context" and neither can be trusted the same way. */
export type Origin = 'captured' | 'authored' | 'derived'

export interface AssetFact {
  what: string
  value: string
  origin: Origin
  source: string
  /** Absent for authored facts, which have a review date instead of a capture time. */
  capturedAt?: string
}

export interface AssetFinding {
  kind: string
  severity: 'danger' | 'caution' | 'info'
  title: string
  detail: string
  source: string
  capturedAt?: string
}

export interface StreamDetails extends TopicSerialization {
  consumers: { group: string; behindRecords: number; retainedRecords: number; percentOfRetention: number }[]
  note: string
}

export interface AssetColumn {
  name: string
  type: string
  constraint?: Column['constraint']
  nullable?: boolean
  note?: string
  /** Set where the column carries a tag of its own, which is where sensitivity usually lives. */
  tags?: string[]
}

export interface AssetContext {
  assetId: string
  name: string
  qualifiedName: string
  kind: Asset['kind']
  serviceId: string
  serviceName: string
  serviceType: string
  description: string
  /**
   * Who wrote the description and whether anybody agreed to it. An agent that will only act on
   * reviewed context reads this; one that will act on anything can ignore it and be wrong faster.
   */
  descriptionReview: Provenance
  owners: Owner[]
  ownersInheritedFrom?: string
  tags: { tag: string; meaning: string }[]
  columns: AssetColumn[]
  facts: AssetFact[]
  findings: AssetFinding[]
  /** Topics only. The half of a stream that lives outside the catalog. */
  stream?: StreamDetails
  deletion: DeletionReview
  cost?: AssetCost
  /** Where a problem with this dataset most likely comes from. */
  diagnosis?: Diagnosis
  /**
   * Inherited from the service, unchanged. An operation on a table is an operation on the service
   * holding it, and a per-asset policy would be a second answer to a question already answered.
   */
  policy: ResolvedPolicy
  note: string
}

/** Tags that say something about handling rather than about subject matter. */
const sensitivityTags = ['pii', 'special-category', 'sensitive', 'credentials', 'pci', 'agent-blocked', 'gdpr-erasure']

function streamFor(asset: Asset): StreamDetails | undefined {
  const serialization = topicSerialization.find((entry) => entry.assetId === asset.id)
  if (!serialization) return undefined
  const health = topicHealthFor(asset.id)
  const consumers = health
    ? [
        {
          group: health.consumerGroup,
          ...(({ lag, retained }) => ({
            behindRecords: lag,
            retainedRecords: retained,
            percentOfRetention: Number(((lag / Math.max(retained, 1)) * 100).toFixed(3)),
          }))(lagOf(health)),
        },
      ]
    : []

  return {
    ...serialization,
    consumers,
    note: consumers.length
      ? 'One consumer group was read. A topic can carry many, and this lists the ones captured rather than the ones that exist.'
      : 'No consumer group was read for this topic, which is not the same as it having none.',
  }
}

/**
 * Findings about the dataset rather than about the service under it. Requirement 4 of G8: lag,
 * dead workflow and sensitivity belong on the thing they are true of, not only on its service.
 */
function findingsFor(asset: Asset, deletion: DeletionReview, stream?: StreamDetails): AssetFinding[] {
  const found: AssetFinding[] = []

  for (const consumer of stream?.consumers ?? []) {
    // The objective lives in objectives.ts; this reports the position rather than re-deciding it.
    if (consumer.percentOfRetention > 50) {
      found.push({
        kind: 'lag-against-retention',
        severity: consumer.percentOfRetention > 80 ? 'danger' : 'caution',
        title: `${consumer.group} is ${consumer.percentOfRetention}% of the way through what this topic keeps`,
        detail:
          'Retention is the deadline rather than the lag itself. Past it, delayed records become lost records and no amount of catching up brings them back.',
        source: 'aiven_kafka_topic_get',
        capturedAt: stream?.capturedAt,
      })
    }
  }

  if (deletion.verdict === 'no sign of use') {
    found.push({
      kind: 'dead-workflow',
      severity: 'info',
      title: 'Nothing that can be seen from here reads this',
      detail: deletion.because,
      source: 'pg_stat_statements read in full, this catalog',
    })
  }

  const sensitive = tagsFor(asset.id, asset.tags).filter((tag) => sensitivityTags.includes(tag))
  if (sensitive.length) {
    found.push({
      kind: 'sensitivity',
      severity: sensitive.includes('agent-blocked') || sensitive.includes('credentials') ? 'danger' : 'caution',
      title: `Tagged ${sensitive.join(', ')}`,
      detail: sensitive.map((tag) => tagDescription(tag) ?? `${tag}, with no description in the vocabulary.`).join(' '),
      source: 'tags in this catalog',
    })
  }

  const order = { danger: 0, caution: 1, info: 2 }
  return found.sort((a, b) => order[a.severity] - order[b.severity])
}

function factsFor(asset: Asset, stream?: StreamDetails): AssetFact[] {
  const facts: AssetFact[] = []
  const catalogued = { origin: 'captured' as const, source: 'this catalog, from the service schema' }

  if (asset.rowCount !== undefined) {
    facts.push({ what: 'Rows', value: asset.rowCount.toLocaleString(), ...catalogued })
  }
  if (asset.partitions !== undefined) {
    facts.push({
      what: 'Partitions',
      value: `${asset.partitions}, replication ${asset.replication ?? 'unknown'}`,
      origin: 'captured',
      source: 'aiven_kafka_topic_get',
      capturedAt: stream?.capturedAt,
    })
  }
  facts.push({ what: 'Columns', value: String(asset.columns.length), ...catalogued })

  const health = topicHealthFor(asset.id)
  if (health) {
    const { bytes } = lagOf(health)
    facts.push({
      what: 'Retained',
      value: `${(bytes / 1024 ** 3).toFixed(2)} GB across ${health.partitions.length} partitions, kept ${health.retentionHours} hours`,
      origin: 'captured',
      source: 'aiven_kafka_topic_get',
      capturedAt: stream?.capturedAt,
    })
    facts.push({
      what: 'In-sync replicas',
      value: `minimum ${health.minInsyncReplicas} required, ${Math.min(...health.partitions.map((p) => p.isr))} observed`,
      origin: 'captured',
      source: 'aiven_kafka_topic_get',
      capturedAt: stream?.capturedAt,
    })
  }

  if (stream) {
    facts.push({
      what: 'Serialization',
      value: `${stream.format}, value subject ${stream.valueSubject}${stream.schemaVersion ? ` at version ${stream.schemaVersion}` : ', version not read'}`,
      origin: 'captured',
      source: 'aiven_kafka_schema_registry_subjects',
      capturedAt: stream.capturedAt,
    })
  }

  // The gap that matters most, stated rather than left as an absent field. Marked derived, not
  // captured: nothing was read to produce it. It is a statement about which tools were run.
  facts.push({
    what: 'Last write',
    value: 'Unknown. No tool read for this project reports a last-write or last-produce time.',
    origin: 'derived',
    source: 'the set of tools read for this project',
  })

  return facts
}

/**
 * The review state of a description, with a default that is a claim rather than a shrug: a sentence
 * that came with the catalogue snapshot was written by whoever built it and is in use, so it counts
 * as accepted. Only generated text is unreviewed, and only until somebody looks at it.
 */
function reviewOf(id: string, snapshotValue: string): Provenance {
  return (
    provenanceOf(id) ?? {
      author: 'the catalog snapshot',
      at: '2026-09-15',
      state: snapshotValue ? 'accepted' : 'suggested',
      sources: ['this catalog, authored when the project was walked'],
    }
  )
}

export function assetContext(assetId: string): AssetContext | undefined {
  const asset = assetById(assetId)
  if (!asset) return undefined
  const service = serviceById(asset.serviceId)
  const owners = resolveOwners(assetId)
  const stream = streamFor(asset)
  const deletion = deletionReview(assetId)!

  return {
    assetId,
    name: asset.name,
    qualifiedName: asset.qualifiedName,
    kind: asset.kind,
    serviceId: asset.serviceId,
    serviceName: service?.name ?? asset.serviceId,
    serviceType: service ? typeLabel(service.type) : 'unknown',
    description: assetDescription(assetId, asset.description),
    descriptionReview: reviewOf(assetId, asset.description),
    owners: owners.owners,
    ownersInheritedFrom: owners.inheritedFrom,
    tags: tagsFor(assetId, asset.tags).map((tag) => ({
      tag,
      meaning: tagDescription(tag) ?? 'Written here, and not in the vocabulary.',
    })),
    columns: asset.columns.map((column) => ({
      name: column.name,
      type: column.type,
      constraint: column.constraint,
      nullable: column.nullable,
      note: columnDescription(assetId, column.name, column.note ?? '') || undefined,
    })),
    facts: factsFor(asset, stream),
    findings: findingsFor(asset, deletion, stream),
    stream,
    deletion,
    cost: costOf(assetId),
    diagnosis: diagnose(assetId),
    policy: policyFor(asset.serviceId),
    note:
      'Descriptions, tags and owners are editable in the browser, and those edits live in that browser rather than in this file. Everything marked captured names the Aiven tool it came from and when it was read.',
  }
}

/** Every dataset, for emitting. Ordered as the catalog holds them so the output is stable. */
export function everyAssetContext(): AssetContext[] {
  return catalog.assets.map((asset) => assetContext(asset.id)!)
}
