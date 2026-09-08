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
  deadline: string
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
export interface Runbook {
  /** The `Finding['kind']` this answers. */
  forFinding: string
  title: string
  /** Ordered, each one thing to do. Tool names are Aiven MCP tools where one exists. */
  steps: string[]
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
