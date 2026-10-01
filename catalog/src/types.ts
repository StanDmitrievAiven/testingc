export type ServiceType =
  | 'pg'
  | 'kafka'
  | 'kafka_connect'
  | 'clickhouse'
  | 'opensearch'
  | 'datahub'
  | 'application'

export type ServiceState = 'RUNNING' | 'POWEROFF'

export type AssetKind =
  | 'table'
  | 'topic'
  | 'clickhouse_table'
  | 'schema'
  | 'connector'
  | 'application'
  | 'catalog'
  | 'dataset'

export type LineageKind =
  | 'cdc'
  | 'kafka_ingest'
  | 'pg_federate'
  | 'app_write'
  | 'app_read'
  | 'metadata'
  | 'query_federation'
  | 'fk'

export interface Column {
  name: string
  type: string
  nullable?: boolean
  constraint?: 'PK' | 'FK' | 'UQ' | null
  default?: string | null
  note?: string
}

export interface Service {
  id: string
  name: string
  type: ServiceType
  state: ServiceState
  role: string
  plan?: string
  version?: string
  cloud?: string
  notes?: string
  stack?: string
}

export interface Asset {
  id: string
  name: string
  qualifiedName: string
  kind: AssetKind
  serviceId: string
  schema?: string
  description: string
  rowCount?: number
  partitions?: number
  replication?: number
  columns: Column[]
  tags: string[]
}

export type IntegrationType =
  | 'debezium_cdc'
  | 'kafka_connect'
  | 'clickhouse_kafka'
  | 'clickhouse_postgresql'
  | 'datahub_metadata_ingestion'
  | 'application_service_credential'
  | 'trino_catalog'

export interface Integration {
  id: string
  type: IntegrationType
  sourceServiceId: string
  destServiceId: string
  active: boolean
  description: string
  /**
   * Where the flow is configured. Absent means an Aiven service integration, and `id` is the
   * first segment of its service_integration_id. The others are real data paths with no
   * integration object in the API, so they cannot be verified against it.
   */
  origin?: 'connector' | 'app-config'
}

export interface LineageEdge {
  id: string
  kind: LineageKind
  sourceAssetId: string
  destAssetId: string
  sourceColumn?: string
  destColumn?: string
  via: string
  confidence: 'column' | 'dataset'
}

export type StackKind = 'product' | 'platform' | 'query' | 'bi'

export interface Stack {
  id: string
  name: string
  kind: StackKind
  description: string
  memberIds: string[]
  primaryRuntimeId?: string
}

/**
 * One purpose-gated mutation recorded by the local mcpproxy that fronts the Aiven MCP server.
 * `serviceId` is the proxy's service name, which is the same string as `Service['id']`.
 */
export interface ContextChange {
  id: number
  serviceId: string
  version: number
  operation: string
  toolName: string
  purpose: string
  status: 'pending' | 'ok' | 'error'
  createdAt: string
  durationMs?: number
  errorText?: string
  clientName: string
}

/** One entry from Aiven's own project event log. `serviceId` matches `Service['id']`. */
export interface ServiceEvent {
  id: string
  serviceId: string
  at: string
  /** An email for a person, or a platform name like `Aiven Automation`. */
  actor: string
  type: string
  description: string
  /** Authored for the demo, not captured from Aiven. Never counted as evidence about a service. */
  sample?: true
}

/**
 * One `pg_stat_statements` row, attributed at capture time to the tables its SQL touches.
 * `tables` holds `Asset['name']` values within the same service, since that is what a table page
 * knows about itself. Times are milliseconds, cumulative since the stats were last reset.
 */
export interface QueryStat {
  id: string
  serviceId: string
  tables: string[]
  sql: string
  calls: number
  meanMs: number
  maxMs: number
  totalMs: number
}

/**
 * How to read a topic: the thing a consumer author needs and cannot get from the catalog. Stuart
 * Mould's list, verbatim — serialization format, schema-registry reference, subject naming
 * strategy — because without them the only way to learn how to deserialize a topic is to consume
 * it and guess.
 */
export interface TopicSerialization {
  assetId: string
  format: string
  keySubject: string
  valueSubject: string
  /** How the subject name is derived from the topic name, which is what a client has to configure. */
  subjectStrategy: string
  registry: string
  /** Absent where the subject was listed but its schema was not read. */
  schemaId?: number
  schemaVersion?: number
  /** Columns the pipeline adds that are in no source table, so a consumer is not surprised by them. */
  envelopeFields?: string[]
  capturedAt: string
}

/**
 * Which tables a service's recorded statements actually name, and how many statements were read to
 * find out. The count is the important half: "no statement names this table" means nothing unless
 * the whole of `pg_stat_statements` was read, and a partial capture would turn a busy table into a
 * dead one. Recorded per service so an uncaptured service reads as unknown rather than as empty.
 */
export interface StatementCoverage {
  serviceId: string
  statements: number
  /** Matched on the table name as a whole word, which over-reports use rather than under-reports it. */
  tablesSeen: string[]
  capturedAt: string
}

export interface PartitionState {
  partition: number
  earliestOffset: number
  latestOffset: number
  /** How far the consumer group has read. Lag is `latestOffset - consumerOffset`. */
  consumerOffset: number
  sizeBytes: number
  /** In-sync replicas. */
  isr: number
}

/** Delivery state of one Kafka topic, keyed by the catalog asset it belongs to. */
export interface TopicHealth {
  assetId: string
  consumerGroup: string
  retentionHours: number
  replication: number
  minInsyncReplicas: number
  partitions: PartitionState[]
}

/** A platform-initiated change Aiven has queued, with the date it stops being optional. */
export interface PendingUpdate {
  description: string
  startAt: string
  /** Absent where Aiven has queued the update without yet setting a date it becomes mandatory. */
  deadline?: string
}

/**
 * The operational facts that decide whether a service is safe to touch right now. Captured only
 * for the services the prototype walks through; pages without an entry simply omit the panel.
 */
export interface ServiceFacts {
  serviceId: string
  planPriceUsdPerHour: number
  /** A single node means a restart is downtime rather than a failover. */
  nodeCount: number
  maintenanceDay: string
  maintenanceTime: string
  terminationProtection: boolean
  /** True when the ip_filter is `0.0.0.0/0` and public access is on. */
  openToInternet: boolean
  techEmails: string[]
  diskMb: number
  maxConnections?: number
  latestBackupAt?: string
  backupCount?: number
  pendingUpdates: PendingUpdate[]
  /**
   * Postgres only. `md5` where the service was never moved to `scram-sha-256`, which is the sort of
   * setting that is invisible per service and obvious across a fleet.
   */
  passwordEncryption?: string
  /**
   * When this entry was read, for services captured later than the rest of the file. Absent means
   * `operationsCapturedAt`: a second capture must not silently borrow the first one's freshness.
   */
  capturedAt?: string
}

/**
 * One metric series as the API summarises it over a window. Kept per service and metric, naming
 * the node the numbers came from: on a three-broker Kafka the brokers differ, and the one that
 * fills first is the one that matters, so the busiest series is the one captured.
 */
export interface MetricReading {
  serviceId: string
  metric: 'cpu_usage' | 'disk_usage' | 'mem_usage'
  /** The node this series belongs to, as the API names it. */
  series: string
  /** Percent, in every metric kept here. */
  min: number
  avg: number
  max: number
  latest: number
  /** The window the summary covers, which is not the same for every service. */
  from: string
  to: string
}

/** A Kafka Connect connector as its runtime reports it. A failed one is invisible in lag alone. */
export interface ConnectorStatus {
  connector: string
  /** The Kafka Connect service running it, not the database it reads. */
  serviceId: string
  state: string
  tasksTotal: number
  tasksRunning: number
  /** The failure trace, when a task has one. */
  trace?: string
}

/** One rung of the plan ladder, so a proposed fix can state its price. */
export interface PlanRung {
  serviceType: string
  plan: string
  cloud: string
  usdPerHour: number
  diskGb: number
  /** Only some plans can buy disk without changing plan; absent means the rung cannot. */
  extraDiskUsdPerGbHour?: number
}

/**
 * A declared definition of healthy: the number a finding compares against, plus who decided it and
 * when they last looked. Every threshold in this prototype used to be a constant halfway down a
 * module, which is an objective nobody can argue with because nobody can find it.
 */
export interface Objective {
  id: string
  /** Service types it covers, or `['*']` for all. The most specific match wins. */
  appliesTo: string[]
  title: string
  /** The number the finding is measured against, in `unit`. */
  target: number
  unit: string
  /** Past this the finding is a danger rather than a caution. Absent where severity never escalates. */
  breach?: number
  /** Why this number and not another. An objective without one is a preference. */
  rationale: string
  owner: string
  /** Last time somebody confirmed it still holds. An unreviewed objective decays into a constant. */
  reviewed: string
}

/**
 * Who answers for a thing. A group is the better answer and the default the UI nudges towards: a
 * person leaves the team and the ownership leaves with them, while a group is a stable identity a
 * dataset can stay attached to. Both are offered because sometimes the honest answer is one person.
 *
 * Owners are declared by whoever is looking at the catalog, and are kept apart from the contacts
 * observed in the Aiven event log everywhere they appear. Merging the two would quietly turn "this
 * person once restarted it" into "this person owns it", which is how an escalation reaches somebody
 * who left.
 */
export interface Owner {
  name: string
  kind: 'person' | 'group'
}

/**
 * What a service is for, and how much its failure costs. Nothing here is declared in Aiven — every
 * service in this project carries an empty `tags: {}` — so these are inferred, and say from what.
 */
export interface Classification {
  serviceId: string
  environment: 'production' | 'staging' | 'development' | 'test'
  criticality: 'critical' | 'important' | 'standard' | 'low'
  /** `declared` is reserved for classification the customer set. Everything here is `inferred`. */
  provenance: 'declared' | 'inferred'
  /** What the inference rests on, so a wrong guess can be corrected rather than argued with. */
  evidence: string
}

/** What an agent may do to a service unattended. Anything unlisted falls back to read-only. */
export interface AgentPolicy {
  serviceId: string
  /** Operations that may run unattended, named as intents rather than tool names. */
  allowed: string[]
  /** Operations that need a human to say yes first. */
  needsApproval: string[]
  /** Operations that must never run here, whatever the reason given. */
  forbidden: string[]
  /** Why this service is held where it is, in one sentence an agent can quote when it declines. */
  because: string
}

/** A window in which nothing changes, whatever the findings say. */
export interface ChangeFreeze {
  from: string
  to: string
  reason: string
}

/**
 * A play for one named finding. The parts that matter to an agent are the ones usually left out of
 * a wiki runbook: what it costs, what breaks while it runs, whether it can be undone, and the check
 * that proves it worked.
 */
/**
 * One way this managed service is not the upstream project. Authored, because no API reports it.
 */
export interface Deviation {
  id: string
  /** `*` for anything on the platform, otherwise the service types it applies to. */
  serviceTypes: string[]
  kind: 'not configurable' | 'managed automatically' | 'differs from upstream'
  title: string
  detail: string
  /** Checked against the live documentation site. Absent only where nothing public covers it. */
  docUrl?: string
  reviewed: string
  /** Not published to customers. Shown to an operator, never written into an emitted document. */
  internal?: boolean
}

export interface Runbook {
  /** The `Finding['kind']` this answers. */
  forFinding: string
  title: string
  /** Ordered, each one thing to do. Tool names are Aiven MCP tools where one exists. */
  steps: string[]
  /**
   * Deviations a step would otherwise contradict, by id. A runbook that says "set the ip filter"
   * cites the absent `pg_hba.conf`, because that is the thing the reader was about to reach for.
   */
  deviations?: string[]
  /** Documentation for the thing being done, rather than for the finding. */
  docUrl?: string
  /** What is unavailable or degraded while the steps run. */
  whileItRuns: string
  /** Rough wall-clock, stated so an agent can decide whether it fits a window. */
  takes: string
  /** How to undo it, or why it cannot be undone: a one-way door has to be named as one. */
  rollback: string
  /** The check that proves the fix worked. Without this a runbook is a suggestion. */
  verify: string
}

/** Something true about a service right now that changes what should happen next. */
export interface Finding {
  /** Stable name, and the key a runbook attaches to. */
  kind: string
  severity: 'danger' | 'caution' | 'info'
  title: string
  detail: string
  /** The `Objective['id']` it breached. Absent only where the finding is a fact, not a threshold. */
  objective?: string
  /** Where to read about the thing itself, so neither a human nor an agent has to go and search. */
  docUrl?: string
  /** Where the claim comes from, so it can be re-checked rather than believed. */
  source: string
  /** When the evidence was read. A finding is only as good as this. */
  capturedAt: string
}

export interface CatalogSnapshot {
  project: string
  organization: string
  capturedAt: string
  cloud: string
  notes: string[]
  services: Service[]
  assets: Asset[]
  integrations: Integration[]
  lineage: LineageEdge[]
  stacks: Stack[]
}
