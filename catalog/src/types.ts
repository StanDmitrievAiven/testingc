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
