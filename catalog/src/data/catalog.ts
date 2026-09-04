import type { Asset, CatalogSnapshot, Column, LineageEdge } from '../types'
import { stacks } from './stacks'

const pgCustomers: Column[] = [
  { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', default: 'nextval' },
  { name: 'email', type: 'text', nullable: false, constraint: 'UQ' },
  { name: 'name', type: 'text', nullable: false },
  { name: 'region', type: 'text', nullable: false },
  { name: 'country', type: 'text', nullable: false },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
  { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' },
]

const pgProducts: Column[] = [
  { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', default: 'nextval' },
  { name: 'sku', type: 'text', nullable: false, constraint: 'UQ' },
  { name: 'name', type: 'text', nullable: false },
  { name: 'category', type: 'text', nullable: false },
  { name: 'price', type: 'numeric(10,2)', nullable: false },
  { name: 'inventory', type: 'integer', nullable: false, default: '0' },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
  { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' },
]

const pgOrders: Column[] = [
  { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', default: 'nextval' },
  { name: 'customer_id', type: 'bigint', nullable: false, constraint: 'FK' },
  { name: 'status', type: 'text', nullable: false, default: "'pending'" },
  { name: 'total', type: 'numeric(12,2)', nullable: false, default: '0' },
  { name: 'region', type: 'text', nullable: false },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
  { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' },
]

const pgOrderItems: Column[] = [
  { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', default: 'nextval' },
  { name: 'order_id', type: 'bigint', nullable: false, constraint: 'FK' },
  { name: 'product_id', type: 'bigint', nullable: false, constraint: 'FK' },
  { name: 'quantity', type: 'integer', nullable: false },
  { name: 'unit_price', type: 'numeric(10,2)', nullable: false },
]

const pgCampaigns: Column[] = [
  { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', default: 'nextval' },
  { name: 'name', type: 'text', nullable: false, constraint: 'UQ' },
  { name: 'region', type: 'text', nullable: false },
  { name: 'country', type: 'text', nullable: true },
  { name: 'channel', type: 'text', nullable: false },
  { name: 'start_date', type: 'date', nullable: false },
  { name: 'end_date', type: 'date', nullable: false },
  { name: 'discount_pct', type: 'numeric(5,2)', nullable: false, default: '0' },
  { name: 'budget_eur', type: 'numeric(12,2)', nullable: false, default: '0' },
  { name: 'target_revenue_eur', type: 'numeric(12,2)', nullable: false, default: '0' },
  { name: 'status', type: 'text', nullable: false, default: "'planned'" },
  { name: 'description', type: 'text', nullable: true },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
  { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' },
]

const crmAccounts: Column[] = [
  { name: 'id', type: 'uuid', nullable: false, constraint: 'PK', default: 'gen_random_uuid()' },
  { name: 'name', type: 'text', nullable: false },
  { name: 'company', type: 'text', nullable: false, default: "''" },
  { name: 'email', type: 'text', nullable: false, default: "''" },
  { name: 'phone', type: 'text', nullable: false, default: "''" },
  { name: 'stage', type: 'text', nullable: false, default: "'lead'" },
  { name: 'value', type: 'integer', nullable: false, default: '0' },
  { name: 'notes', type: 'text', nullable: false, default: "''" },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
  { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' },
  { name: 'next_action', type: 'text', nullable: false, default: "''" },
  { name: 'follow_up_on', type: 'text', nullable: false, default: "''" },
  { name: 'lost_reason', type: 'text', nullable: false, default: "''" },
]

const crmAccountNotes: Column[] = [
  { name: 'id', type: 'uuid', nullable: false, constraint: 'PK', default: 'gen_random_uuid()' },
  { name: 'account_id', type: 'uuid', nullable: false, constraint: 'FK' },
  { name: 'body', type: 'text', nullable: false },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
]

const cdcMeta: Column[] = [
  { name: '__op', type: 'string?', nullable: true, note: 'Debezium op (c/u/d/r)' },
  { name: '__source_ts_ms', type: 'long?', nullable: true, note: 'Source commit timestamp' },
  { name: '__deleted', type: 'string?', nullable: true, note: 'ExtractNewRecordState flag' },
]

function avroFromPg(cols: Column[], numericAsString: string[] = []): Column[] {
  return [
    ...cols.map((col) => ({
      ...col,
      type: numericAsString.includes(col.name)
        ? 'string'
        : col.type.startsWith('numeric')
          ? 'string'
          : col.type.startsWith('timestamp')
            ? 'string (ZonedTimestamp)'
            : col.type === 'bigint'
              ? 'long'
              : col.type === 'integer'
                ? 'int'
                : 'string',
      constraint: undefined,
      default: undefined,
    })),
    ...cdcMeta,
  ]
}

function chFromAvro(cols: Column[]): Column[] {
  return cols.map((col) => ({
    ...col,
    type:
      col.name === '__source_ts_ms'
        ? 'Int64'
        : col.type.startsWith('long') || col.type === 'long'
          ? 'Int64'
          : col.type === 'int'
            ? 'Int32'
            : 'String',
  }))
}

const kafkaCustomers = avroFromPg(pgCustomers)
const kafkaProducts = avroFromPg(pgProducts, ['price'])
const kafkaOrders = avroFromPg(pgOrders, ['total'])
const kafkaOrderItems = avroFromPg(pgOrderItems, ['unit_price'])

function table(
  id: string,
  name: string,
  serviceId: string,
  schema: string,
  description: string,
  columns: Column[],
  extras: Partial<Asset> = {},
): Asset {
  return {
    id,
    name,
    qualifiedName: `${serviceId}.${schema}.${name}`,
    kind: extras.kind ?? 'table',
    serviceId,
    schema,
    description,
    columns,
    tags: extras.tags ?? [],
    rowCount: extras.rowCount,
    partitions: extras.partitions,
    replication: extras.replication,
  }
}

function pipelineLineage(
  tableName: string,
  pgCols: Column[],
  kafkaCols: Column[],
  chCols: Column[],
): LineageEdge[] {
  const edges: LineageEdge[] = []
  const pgId = `pg.public.${tableName}`
  const kafkaId = `kafka.webshop.public.${tableName}`
  const chId = `ch.service_kafka.customers`.replace('customers', tableName)

  for (const col of pgCols) {
    const inKafka = kafkaCols.some((c) => c.name === col.name)
    const inCh = chCols.some((c) => c.name === col.name)
    if (inKafka) {
      edges.push({
        id: `${pgId}.${col.name}->${kafkaId}.${col.name}`,
        kind: 'cdc',
        sourceAssetId: pgId,
        destAssetId: kafkaId,
        sourceColumn: col.name,
        destColumn: col.name,
        via: 'webshop-pg-cdc · Debezium pgoutput',
        confidence: 'column',
      })
    }
    if (inKafka && inCh) {
      edges.push({
        id: `${kafkaId}.${col.name}->${chId}.${col.name}`,
        kind: 'kafka_ingest',
        sourceAssetId: kafkaId,
        destAssetId: chId,
        sourceColumn: col.name,
        destColumn: col.name,
        via: 'clickhouse_kafka · AvroConfluent',
        confidence: 'column',
      })
    }
  }

  for (const col of cdcMeta) {
    edges.push({
      id: `${kafkaId}.${col.name}->${chId}.${col.name}`,
      kind: 'kafka_ingest',
      sourceAssetId: kafkaId,
      destAssetId: chId,
      sourceColumn: col.name,
      destColumn: col.name,
      via: 'clickhouse_kafka · AvroConfluent',
      confidence: 'column',
    })
  }

  return edges
}

const marmotCoreTables = [
  {
    name: 'assets',
    description: 'Marmot registered data assets with schema JSON and search text.',
    columns: [
      { name: 'id', type: 'varchar', nullable: false, constraint: 'PK' as const },
      { name: 'name', type: 'varchar', nullable: false },
      { name: 'mrn', type: 'varchar', nullable: false },
      { name: 'type', type: 'varchar', nullable: false },
      { name: 'providers', type: 'text[]', nullable: false },
      { name: 'environments', type: 'jsonb', nullable: false },
      { name: 'description', type: 'text', nullable: true },
      { name: 'metadata', type: 'jsonb', nullable: false },
      { name: 'schema', type: 'jsonb', nullable: false },
      { name: 'sources', type: 'jsonb', nullable: false },
      { name: 'tags', type: 'text[]', nullable: false },
      { name: 'query', type: 'text', nullable: true },
      { name: 'is_stub', type: 'boolean', nullable: false },
      { name: 'created_at', type: 'timestamptz', nullable: false },
      { name: 'updated_at', type: 'timestamptz', nullable: false },
    ],
  },
  {
    name: 'lineage_edges',
    description: 'Observed or declared lineage between Marmot resource names.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, constraint: 'PK' as const },
      { name: 'source_mrn', type: 'varchar', nullable: false },
      { name: 'target_mrn', type: 'varchar', nullable: false },
      { name: 'event_id', type: 'uuid', nullable: false },
      { name: 'job_mrn', type: 'varchar', nullable: true },
      { name: 'type', type: 'varchar', nullable: true },
      { name: 'origin', type: 'varchar', nullable: false },
      { name: 'observation_count', type: 'integer', nullable: false },
      { name: 'last_seen_at', type: 'timestamptz', nullable: false },
    ],
  },
  {
    name: 'data_products',
    description: 'Marmot data product registry.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, constraint: 'PK' as const },
      { name: 'name', type: 'varchar', nullable: false },
      { name: 'description', type: 'text', nullable: true },
      { name: 'metadata', type: 'jsonb', nullable: false },
      { name: 'tags', type: 'text[]', nullable: false },
      { name: 'membership_count', type: 'integer', nullable: false },
    ],
  },
  {
    name: 'glossary_terms',
    description: 'Business glossary used by Marmot.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, constraint: 'PK' as const },
      { name: 'name', type: 'varchar', nullable: false },
      { name: 'definition', type: 'text', nullable: false },
      { name: 'parent_term_id', type: 'uuid', nullable: true, constraint: 'FK' as const },
      { name: 'tags', type: 'text[]', nullable: true },
    ],
  },
]

const marmotTableNames = [
  'agent_runs',
  'agent_tool_calls',
  'aggregated_metrics',
  'api_keys',
  'asset_owners',
  'asset_rule_memberships',
  'asset_rule_targets',
  'asset_rule_terms',
  'asset_rules',
  'asset_schedules',
  'asset_statistics',
  'asset_subscriptions',
  'asset_tags',
  'asset_terms',
  'data_product_memberships',
  'data_product_owners',
  'data_product_rule_targets',
  'data_product_rules',
  'doc_images',
  'doc_pages',
  'documentation',
  'global_documentation',
  'glossary_term_owners',
  'ingestion_job_runs',
  'ingestion_schedules',
  'lineage_events',
  'lookup_counters',
  'metrics_timeseries',
  'notifications',
  'permissions',
  'product_images',
  'raw_metrics',
  'role_permissions',
  'roles',
  'run_checkpoints',
  'run_entities',
  'run_history',
  'runs',
  'schema_version',
  'search_index',
  'service_account_api_keys',
  'service_account_roles',
  'service_accounts',
  'sso_team_mappings',
  'summary_counts',
  'system_secrets',
  'team_members',
  'team_webhooks',
  'teams',
  'telemetry_install',
  'user_identities',
  'user_roles',
  'users',
]

export const catalog: CatalogSnapshot = {
  project: 'data-innovation-summit',
  organization: 'Aiven · Employee Playground',
  capturedAt: '2026-09-04T10:55:00Z',
  cloud: 'aws-eu-west-1',
  notes: [
    'Read-only snapshot from Aiven MCP. Nothing in the project was changed.',
    'Re-checked against the Aiven API on 2026-09-04: added the crm services, dropped the deleted datahub-ayes-test-1 stack, and corrected the DataHub ingestion set.',
    'Integration ids are the first segment of the real service_integration_id, except the three marked with an origin, which have no integration object in the API.',
    'Column-level lineage comes from Debezium + Schema Registry + clickhouse_kafka table mappings.',
    'DataHub holds metadata but no lineage: both live ingestions run with emit_lineage off.',
    'Trino federation is app configuration, not an Aiven integration; the catalogs are summit_pg and summit_clickhouse.',
  ],
  services: [
    { id: 'webshop-simulator', name: 'webshop-simulator', type: 'application', state: 'RUNNING', role: 'Synthetic order writer', notes: 'Writes into pg-37c7de3b via application credential.' },
    { id: 'pg-37c7de3b', name: 'pg-37c7de3b', type: 'pg', state: 'RUNNING', role: 'Webshop system of record', plan: 'startup-4', version: '17.11', cloud: 'aws-eu-west-1' },
    { id: 'kafkaconnect-30e121dd', name: 'kafkaconnect-30e121dd', type: 'kafka_connect', state: 'RUNNING', role: 'CDC runtime', notes: 'Debezium Postgres connector webshop-pg-cdc is RUNNING.' },
    { id: 'kafka-1b5cb1e7', name: 'kafka-1b5cb1e7', type: 'kafka', state: 'RUNNING', role: 'CDC event bus + Schema Registry' },
    { id: 'clickhouse-2a6274d2', name: 'clickhouse-2a6274d2', type: 'clickhouse', state: 'RUNNING', role: 'Analytics warehouse', plan: 'startup-8', version: '25.8' },
    { id: 'trino-hub', name: 'trino-hub', type: 'application', state: 'RUNNING', role: 'Federated query layer', notes: 'Catalogs: summit_pg, summit_clickhouse.' },
    { id: 'trino-hub-pg', name: 'trino-hub-pg', type: 'pg', state: 'RUNNING', role: 'Trino control plane' },
    { id: 'trino2', name: 'trino2', type: 'application', state: 'RUNNING', role: 'Second Trino app' },
    { id: 'trino2-pg', name: 'trino2-pg', type: 'pg', state: 'POWEROFF', role: 'Trino2 control plane' },
    { id: 'datahub-1c8ec127', name: 'datahub-1c8ec127', type: 'datahub', state: 'RUNNING', role: 'Active metadata catalog', notes: 'Ingests pg-37c7de3b and trino-hub-pg. emit_lineage is off on both, so DataHub holds metadata but no lineage.' },
    { id: 'marmot-catalog', name: 'marmot-catalog', type: 'application', state: 'RUNNING', role: 'Marmot data catalog UI' },
    { id: 'marmot-pg', name: 'marmot-pg', type: 'pg', state: 'RUNNING', role: 'Marmot catalog store' },
    { id: 'analytics-agent', name: 'analytics-agent', type: 'application', state: 'RUNNING', role: 'Conversational analytics app' },
    { id: 'analytics-agent-pg', name: 'analytics-agent-pg', type: 'pg', state: 'RUNNING', role: 'Analytics agent store' },
    { id: 'dashboard-api', name: 'dashboard-api', type: 'application', state: 'RUNNING', role: 'Dashboard API' },
    { id: 'dashboard-web', name: 'dashboard-web', type: 'application', state: 'RUNNING', role: 'Dashboard UI' },
    { id: 'lightdash', name: 'lightdash', type: 'application', state: 'RUNNING', role: 'BI app', notes: 'Credential points at pg-lightdash, which is powered off.' },
    { id: 'pg-lightdash', name: 'pg-lightdash', type: 'pg', state: 'POWEROFF', role: 'Lightdash metadata DB' },
    { id: 'datahub-mcp', name: 'datahub-mcp', type: 'application', state: 'RUNNING', role: 'DataHub MCP gateway' },
    { id: 'datahub-connection-wizard', name: 'datahub-connection-wizard', type: 'application', state: 'RUNNING', role: 'DataHub connection UI' },
    { id: 'managed-agents-e55f68a7-runtime', name: 'managed-agents-e55f68a7-runtime', type: 'application', state: 'RUNNING', role: 'Managed agents runtime' },
    { id: 'managed-agents-e55f68a7-db', name: 'managed-agents-e55f68a7-db', type: 'pg', state: 'RUNNING', role: 'Managed agents DB' },
    { id: 'crm-app', name: 'crm-app', type: 'application', state: 'RUNNING', role: 'CRM web app', notes: 'Reads and writes crm-pg through an application credential.' },
    { id: 'crm-sql', name: 'crm-sql', type: 'application', state: 'RUNNING', role: 'CRM query editor', notes: 'Query editor over the same crm-pg database.' },
    { id: 'crm-pg', name: 'crm-pg', type: 'pg', state: 'RUNNING', role: 'CRM system of record', cloud: 'aws-eu-west-1' },
    { id: 'datahub-1c8ec127-frontend', name: 'datahub-1c8ec127-frontend', type: 'application', state: 'RUNNING', role: 'DataHub UI', stack: 'datahub-1c8ec127' },
    { id: 'datahub-1c8ec127-gms', name: 'datahub-1c8ec127-gms', type: 'application', state: 'RUNNING', role: 'DataHub GMS', stack: 'datahub-1c8ec127' },
    { id: 'datahub-1c8ec127-actions', name: 'datahub-1c8ec127-actions', type: 'application', state: 'RUNNING', role: 'DataHub actions', stack: 'datahub-1c8ec127' },
    { id: 'datahub-1c8ec127-upgrade', name: 'datahub-1c8ec127-upgrade', type: 'application', state: 'POWEROFF', role: 'DataHub upgrade job', stack: 'datahub-1c8ec127' },
    { id: 'datahub-1c8ec127-kafka', name: 'datahub-1c8ec127-kafka', type: 'kafka', state: 'RUNNING', role: 'DataHub internal Kafka', stack: 'datahub-1c8ec127' },
    { id: 'datahub-1c8ec127-opensearch', name: 'datahub-1c8ec127-opensearch', type: 'opensearch', state: 'RUNNING', role: 'DataHub search index', stack: 'datahub-1c8ec127' },
    { id: 'datahub-1c8ec127-postgresql', name: 'datahub-1c8ec127-postgresql', type: 'pg', state: 'RUNNING', role: 'DataHub metadata DB', stack: 'datahub-1c8ec127' },
    { id: 'os-ddec4cf-dhtest', name: 'os-ddec4cf-dhtest', type: 'opensearch', state: 'POWEROFF', role: 'Idle OpenSearch test cluster' },
  ],
  assets: [
    table('pg.public.customers', 'customers', 'pg-37c7de3b', 'public', 'Webshop customers. Source of CDC topic webshop.public.customers.', pgCustomers, { rowCount: 895294, tags: ['webshop', 'pii', 'cdc'] }),
    table('pg.public.products', 'products', 'pg-37c7de3b', 'public', 'Product catalog sourced by the simulator and streamed via Debezium.', pgProducts, { rowCount: 51, tags: ['webshop', 'cdc'] }),
    table('pg.public.orders', 'orders', 'pg-37c7de3b', 'public', 'Orders written by webshop-simulator. FK to customers.', pgOrders, { rowCount: 6258540, tags: ['webshop', 'cdc', 'fact'] }),
    table('pg.public.order_items', 'order_items', 'pg-37c7de3b', 'public', 'Line items. FK to orders and products.', pgOrderItems, { rowCount: 15648526, tags: ['webshop', 'cdc', 'fact'] }),
    table('pg.marketing.campaigns', 'campaigns', 'pg-37c7de3b', 'marketing', 'Marketing campaigns federated into ClickHouse over clickhouse_postgresql.', pgCampaigns, { rowCount: 16, tags: ['marketing'] }),

    {
      ...table('kafka.webshop.public.customers', 'webshop.public.customers', 'kafka-1b5cb1e7', 'webshop.public', 'CDC topic. Avro value subject webshop.public.customers-value.', kafkaCustomers, { kind: 'topic', partitions: 3, replication: 3, tags: ['cdc', 'avro'] }),
      qualifiedName: 'kafka-1b5cb1e7.webshop.public.customers',
    },
    {
      ...table('kafka.webshop.public.products', 'webshop.public.products', 'kafka-1b5cb1e7', 'webshop.public', 'CDC topic. Avro value subject webshop.public.products-value.', kafkaProducts, { kind: 'topic', partitions: 3, replication: 3, tags: ['cdc', 'avro'] }),
      qualifiedName: 'kafka-1b5cb1e7.webshop.public.products',
    },
    {
      ...table('kafka.webshop.public.orders', 'webshop.public.orders', 'kafka-1b5cb1e7', 'webshop.public', 'CDC topic. Avro value subject webshop.public.orders-value.', kafkaOrders, { kind: 'topic', partitions: 3, replication: 3, tags: ['cdc', 'avro'] }),
      qualifiedName: 'kafka-1b5cb1e7.webshop.public.orders',
    },
    {
      ...table('kafka.webshop.public.order_items', 'webshop.public.order_items', 'kafka-1b5cb1e7', 'webshop.public', 'CDC topic. Avro value subject webshop.public.order_items-value.', kafkaOrderItems, { kind: 'topic', partitions: 3, replication: 3, tags: ['cdc', 'avro'] }),
      qualifiedName: 'kafka-1b5cb1e7.webshop.public.order_items',
    },

    {
      id: 'connect.webshop-pg-cdc',
      name: 'webshop-pg-cdc',
      qualifiedName: 'kafkaconnect-30e121dd.webshop-pg-cdc',
      kind: 'connector',
      serviceId: 'kafkaconnect-30e121dd',
      description: 'Debezium 3.1.0 PostgresConnector. Tables public.customers, products, orders, order_items. Slot debezium_webshop, unwrap SMT, Avro converters.',
      columns: [
        { name: 'connector.class', type: 'io.debezium.connector.postgresql.PostgresConnector' },
        { name: 'plugin.name', type: 'pgoutput' },
        { name: 'slot.name', type: 'debezium_webshop' },
        { name: 'topic.prefix', type: 'webshop' },
        { name: 'snapshot.mode', type: 'initial' },
        { name: 'decimal.handling.mode', type: 'string' },
      ],
      tags: ['cdc', 'running'],
    },

    table('ch.service_kafka.customers', 'customers', 'clickhouse-2a6274d2', 'service_kafka-1b5cb1e7', 'ClickHouse Kafka engine table. Group ch-webshop-customers-avro-v1, AvroConfluent, offset latest.', chFromAvro(kafkaCustomers), { kind: 'clickhouse_table', tags: ['cdc', 'avro'] }),
    table('ch.service_kafka.products', 'products', 'clickhouse-2a6274d2', 'service_kafka-1b5cb1e7', 'ClickHouse Kafka engine table for product CDC.', chFromAvro(kafkaProducts), { kind: 'clickhouse_table', tags: ['cdc', 'avro'] }),
    table('ch.service_kafka.orders', 'orders', 'clickhouse-2a6274d2', 'service_kafka-1b5cb1e7', 'ClickHouse Kafka engine table for order CDC.', chFromAvro(kafkaOrders), { kind: 'clickhouse_table', tags: ['cdc', 'avro'] }),
    table('ch.service_kafka.order_items', 'order_items', 'clickhouse-2a6274d2', 'service_kafka-1b5cb1e7', 'ClickHouse Kafka engine table for order item CDC.', chFromAvro(kafkaOrderItems), { kind: 'clickhouse_table', tags: ['cdc', 'avro'] }),
    table('ch.pg.marketing.campaigns', 'campaigns', 'clickhouse-2a6274d2', 'service_pg-37c7de3b.marketing', 'PostgreSQL engine over marketing.campaigns via clickhouse_postgresql.', pgCampaigns.map((c) => ({ ...c, note: 'Federated from PostgreSQL' })), { kind: 'clickhouse_table', rowCount: 16, tags: ['marketing', 'federated'] }),

    {
      id: 'trino.summit_pg',
      name: 'summit_pg',
      qualifiedName: 'trino-hub.summit_pg',
      kind: 'catalog',
      serviceId: 'trino-hub',
      description: 'Trino catalog federating pg-37c7de3b. Configured in trino_catalogs.',
      columns: [],
      tags: ['federation'],
    },
    {
      id: 'trino.summit_clickhouse',
      name: 'summit_clickhouse',
      qualifiedName: 'trino-hub.summit_clickhouse',
      kind: 'catalog',
      serviceId: 'trino-hub',
      description: 'Trino catalog federating clickhouse-2a6274d2.',
      columns: [],
      tags: ['federation'],
    },

    table('agent.conversations', 'conversations', 'analytics-agent-pg', 'public', 'Chat sessions for the analytics agent.', [
      { name: 'id', type: 'varchar', nullable: false, constraint: 'PK' },
      { name: 'title', type: 'varchar', nullable: false },
      { name: 'engine_name', type: 'varchar', nullable: false },
      { name: 'created_at', type: 'timestamptz', nullable: false },
      { name: 'updated_at', type: 'timestamptz', nullable: false },
      { name: 'quality_score', type: 'integer', nullable: true },
      { name: 'quality_label', type: 'varchar', nullable: true },
      { name: 'quality_reason', type: 'text', nullable: true },
    ], { tags: ['app'] }),
    table('agent.messages', 'messages', 'analytics-agent-pg', 'public', 'Conversation events for the analytics agent.', [
      { name: 'id', type: 'varchar', nullable: false, constraint: 'PK' },
      { name: 'conversation_id', type: 'varchar', nullable: false, constraint: 'FK' },
      { name: 'event_type', type: 'varchar', nullable: false },
      { name: 'role', type: 'varchar', nullable: false },
      { name: 'payload', type: 'text', nullable: false },
      { name: 'sequence', type: 'integer', nullable: false },
      { name: 'created_at', type: 'timestamptz', nullable: false },
    ], { tags: ['app'] }),
    table('agent.integrations', 'integrations', 'analytics-agent-pg', 'public', 'Configured agent integrations.', [
      { name: 'id', type: 'varchar', nullable: false, constraint: 'PK' },
      { name: 'name', type: 'varchar', nullable: false },
      { name: 'type', type: 'varchar', nullable: false },
      { name: 'label', type: 'varchar', nullable: false },
      { name: 'config', type: 'text', nullable: false },
      { name: 'source', type: 'varchar', nullable: false },
    ], { tags: ['app'] }),
    table('agent.context_platforms', 'context_platforms', 'analytics-agent-pg', 'public', 'Context platforms the agent can query.', [
      { name: 'id', type: 'varchar', nullable: false, constraint: 'PK' },
      { name: 'type', type: 'varchar', nullable: false },
      { name: 'name', type: 'varchar', nullable: false },
      { name: 'label', type: 'varchar', nullable: false },
      { name: 'config', type: 'text', nullable: false },
      { name: 'source', type: 'varchar', nullable: false },
    ], { tags: ['app'] }),
    table('agent.settings', 'settings', 'analytics-agent-pg', 'public', 'Key-value settings for the analytics agent.', [
      { name: 'key', type: 'varchar', nullable: false, constraint: 'PK' },
      { name: 'value', type: 'text', nullable: true },
      { name: 'updated_at', type: 'timestamptz', nullable: false },
    ], { tags: ['app'] }),

    table('crm.public.accounts', 'accounts', 'crm-pg', 'public', 'CRM accounts and pipeline stages. Written by crm-app.', crmAccounts, { rowCount: 2, tags: ['crm', 'pii'] }),
    table('crm.public.account_notes', 'account_notes', 'crm-pg', 'public', 'Free-text notes per account. FK to accounts.', crmAccountNotes, { rowCount: 2, tags: ['crm'] }),

    table('trino.trino_catalogs', 'trino_catalogs', 'trino-hub-pg', 'public', 'Registered Trino catalogs.', [
      { name: 'id', type: 'integer', nullable: false, constraint: 'PK' },
      { name: 'name', type: 'varchar', nullable: false },
      { name: 'properties', type: 'jsonb', nullable: false },
      { name: 'created_at', type: 'timestamptz', nullable: true },
    ], { tags: ['control-plane'] }),
    table('trino.trino_audit_events', 'trino_audit_events', 'trino-hub-pg', 'public', 'Trino query and actor audit log.', [
      { name: 'id', type: 'bigint', nullable: false, constraint: 'PK' },
      { name: 'actor_type', type: 'varchar', nullable: false },
      { name: 'actor_id', type: 'varchar', nullable: false },
      { name: 'action', type: 'varchar', nullable: false },
      { name: 'query_hash', type: 'text', nullable: true },
      { name: 'created_at', type: 'timestamptz', nullable: false },
    ], { tags: ['control-plane'] }),
    table('trino.trino_kafka_config', 'trino_kafka_config', 'trino-hub-pg', 'public', 'Kafka connector configuration blob for Trino.', [
      { name: 'id', type: 'integer', nullable: false, constraint: 'PK' },
      { name: 'config_text', type: 'text', nullable: false },
      { name: 'created_at', type: 'timestamptz', nullable: true },
    ], { tags: ['control-plane'] }),
    table('trino.trino_users', 'trino_users', 'trino-hub-pg', 'public', 'Trino hub users.', [
      { name: 'id', type: 'uuid', nullable: false, constraint: 'PK' },
      { name: 'username', type: 'varchar', nullable: false },
      { name: 'role', type: 'varchar', nullable: false },
      { name: 'enabled', type: 'boolean', nullable: false },
    ], { tags: ['control-plane'] }),
    table('trino.trino_mcp_api_keys', 'trino_mcp_api_keys', 'trino-hub-pg', 'public', 'API keys for the Trino MCP server.', [
      { name: 'id', type: 'uuid', nullable: false, constraint: 'PK' },
      { name: 'name', type: 'varchar', nullable: false },
      { name: 'role', type: 'varchar', nullable: false },
      { name: 'enabled', type: 'boolean', nullable: false },
      { name: 'revoked_at', type: 'timestamptz', nullable: true },
    ], { tags: ['control-plane'] }),

    ...marmotCoreTables.map((t) =>
      table(`marmot.${t.name}`, t.name, 'marmot-pg', 'public', t.description, t.columns, { tags: ['marmot'] }),
    ),
    ...marmotTableNames.map((name) =>
      table(`marmot.${name}`, name, 'marmot-pg', 'public', `Marmot catalog table ${name}. Column list not expanded in this snapshot.`, [], { tags: ['marmot'] }),
    ),

    {
      id: 'app.webshop-simulator',
      name: 'webshop-simulator',
      qualifiedName: 'application.webshop-simulator',
      kind: 'application',
      serviceId: 'webshop-simulator',
      description: 'Produces webshop traffic into PostgreSQL. Active application_service_credential from pg-37c7de3b.',
      columns: [],
      tags: ['producer'],
    },
    {
      id: 'app.analytics-agent',
      name: 'analytics-agent',
      qualifiedName: 'application.analytics-agent',
      kind: 'application',
      serviceId: 'analytics-agent',
      description: 'Conversational analytics application backed by analytics-agent-pg.',
      columns: [],
      tags: ['consumer'],
    },
    {
      id: 'app.trino-hub',
      name: 'trino-hub',
      qualifiedName: 'application.trino-hub',
      kind: 'application',
      serviceId: 'trino-hub',
      description: 'Trino query hub with catalogs summit_pg and summit_clickhouse.',
      columns: [],
      tags: ['query'],
    },
    {
      id: 'app.marmot-catalog',
      name: 'marmot-catalog',
      qualifiedName: 'application.marmot-catalog',
      kind: 'application',
      serviceId: 'marmot-catalog',
      description: 'Marmot catalog UI. Credential from marmot-pg.',
      columns: [],
      tags: ['catalog'],
    },
    {
      id: 'app.lightdash',
      name: 'lightdash',
      qualifiedName: 'application.lightdash',
      kind: 'application',
      serviceId: 'lightdash',
      description: 'Lightdash BI. Credential enabled against pg-lightdash, which is currently powered off.',
      columns: [],
      tags: ['bi'],
    },
    {
      id: 'app.crm-app',
      name: 'crm-app',
      qualifiedName: 'application.crm-app',
      kind: 'application',
      serviceId: 'crm-app',
      description: 'CRM UI. Active application_service_credential from crm-pg.',
      columns: [],
      tags: ['producer'],
    },
    {
      id: 'app.crm-sql',
      name: 'crm-sql',
      qualifiedName: 'application.crm-sql',
      kind: 'application',
      serviceId: 'crm-sql',
      description: 'SQL query editor over crm-pg. Active application_service_credential.',
      columns: [],
      tags: ['consumer'],
    },
    {
      id: 'app.datahub-1c8ec127',
      name: 'datahub-1c8ec127',
      qualifiedName: 'datahub.datahub-1c8ec127',
      kind: 'catalog',
      serviceId: 'datahub-1c8ec127',
      description: 'The project DataHub. Active metadata ingestion from pg-37c7de3b and trino-hub-pg, both with emit_lineage off.',
      columns: [],
      tags: ['governance'],
    },
  ],
  integrations: [
    { id: '0da010dc', type: 'application_service_credential', sourceServiceId: 'pg-37c7de3b', destServiceId: 'webshop-simulator', active: true, description: 'Simulator writes webshop rows into PostgreSQL.' },
    { id: 'a7006972', type: 'kafka_connect', sourceServiceId: 'kafka-1b5cb1e7', destServiceId: 'kafkaconnect-30e121dd', active: true, description: 'Dedicated Connect cluster attached to the webshop Kafka.' },
    { id: 'webshop-pg-cdc', type: 'debezium_cdc', sourceServiceId: 'pg-37c7de3b', destServiceId: 'kafka-1b5cb1e7', active: true, origin: 'connector', description: 'Kafka Connect connector webshop-pg-cdc: Debezium pgoutput on publication debezium_webshop, four public tables to Avro topics. Runs on kafkaconnect-30e121dd rather than as its own integration.' },
    { id: '88d193b1', type: 'clickhouse_kafka', sourceServiceId: 'kafka-1b5cb1e7', destServiceId: 'clickhouse-2a6274d2', active: true, description: 'Four AvroConfluent Kafka engine tables, column-mapped.' },
    { id: '08ddec12', type: 'clickhouse_postgresql', sourceServiceId: 'pg-37c7de3b', destServiceId: 'clickhouse-2a6274d2', active: true, description: 'Federates defaultdb.marketing into ClickHouse.' },
    { id: 'ee61cdb7', type: 'datahub_metadata_ingestion', sourceServiceId: 'pg-37c7de3b', destServiceId: 'datahub-1c8ec127', active: true, description: 'PostgreSQL metadata into DataHub. emit_lineage is off, so no lineage is emitted.' },
    { id: '8265d35c', type: 'datahub_metadata_ingestion', sourceServiceId: 'trino-hub-pg', destServiceId: 'datahub-1c8ec127', active: true, description: 'Trino control-plane database metadata into DataHub.' },
    { id: '66046934', type: 'application_service_credential', sourceServiceId: 'analytics-agent-pg', destServiceId: 'analytics-agent', active: true, description: 'Agent application database.' },
    { id: 'a5b2ef5b', type: 'application_service_credential', sourceServiceId: 'trino-hub-pg', destServiceId: 'trino-hub', active: true, description: 'Trino hub control-plane database.' },
    { id: '63f7e5ab', type: 'application_service_credential', sourceServiceId: 'marmot-pg', destServiceId: 'marmot-catalog', active: true, description: 'Marmot catalog database.' },
    { id: '0788a9b6', type: 'application_service_credential', sourceServiceId: 'pg-lightdash', destServiceId: 'lightdash', active: false, description: 'Enabled credential, destination Postgres is powered off.' },
    { id: '7330e73c', type: 'application_service_credential', sourceServiceId: 'managed-agents-e55f68a7-db', destServiceId: 'managed-agents-e55f68a7-runtime', active: true, description: 'Managed agents runtime database.' },
    { id: 'b1ea29ce', type: 'application_service_credential', sourceServiceId: 'crm-pg', destServiceId: 'crm-app', active: true, description: 'CRM application database.' },
    { id: 'bab08dcb', type: 'application_service_credential', sourceServiceId: 'crm-pg', destServiceId: 'crm-sql', active: true, description: 'Query editor reads the same CRM database.' },
    { id: 'summit_pg', type: 'trino_catalog', sourceServiceId: 'pg-37c7de3b', destServiceId: 'trino-hub', active: true, origin: 'app-config', description: 'Trino catalog summit_pg, configured inside the Trino application. Aiven has no Trino integration type, so there is nothing to verify against the API.' },
    { id: 'summit_clickhouse', type: 'trino_catalog', sourceServiceId: 'clickhouse-2a6274d2', destServiceId: 'trino-hub', active: true, origin: 'app-config', description: 'Trino catalog summit_clickhouse, configured inside the Trino application.' },
  ],
  lineage: [
    ...pipelineLineage('customers', pgCustomers, kafkaCustomers, chFromAvro(kafkaCustomers)),
    ...pipelineLineage('products', pgProducts, kafkaProducts, chFromAvro(kafkaProducts)),
    ...pipelineLineage('orders', pgOrders, kafkaOrders, chFromAvro(kafkaOrders)),
    ...pipelineLineage('order_items', pgOrderItems, kafkaOrderItems, chFromAvro(kafkaOrderItems)),
    ...pgCampaigns.map((col) => ({
      id: `pg.marketing.campaigns.${col.name}->ch.pg.marketing.campaigns.${col.name}`,
      kind: 'pg_federate' as const,
      sourceAssetId: 'pg.marketing.campaigns',
      destAssetId: 'ch.pg.marketing.campaigns',
      sourceColumn: col.name,
      destColumn: col.name,
      via: 'clickhouse_postgresql · defaultdb.marketing',
      confidence: 'column' as const,
    })),
    {
      id: 'sim->customers',
      kind: 'app_write',
      sourceAssetId: 'app.webshop-simulator',
      destAssetId: 'pg.public.customers',
      via: 'application_service_credential',
      confidence: 'dataset',
    },
    {
      id: 'sim->products',
      kind: 'app_write',
      sourceAssetId: 'app.webshop-simulator',
      destAssetId: 'pg.public.products',
      via: 'application_service_credential',
      confidence: 'dataset',
    },
    {
      id: 'sim->orders',
      kind: 'app_write',
      sourceAssetId: 'app.webshop-simulator',
      destAssetId: 'pg.public.orders',
      via: 'application_service_credential',
      confidence: 'dataset',
    },
    {
      id: 'sim->items',
      kind: 'app_write',
      sourceAssetId: 'app.webshop-simulator',
      destAssetId: 'pg.public.order_items',
      via: 'application_service_credential',
      confidence: 'dataset',
    },
    {
      id: 'fk.orders.customer_id',
      kind: 'fk',
      sourceAssetId: 'pg.public.orders',
      destAssetId: 'pg.public.customers',
      sourceColumn: 'customer_id',
      destColumn: 'id',
      via: 'PostgreSQL foreign key',
      confidence: 'column',
    },
    {
      id: 'fk.items.order_id',
      kind: 'fk',
      sourceAssetId: 'pg.public.order_items',
      destAssetId: 'pg.public.orders',
      sourceColumn: 'order_id',
      destColumn: 'id',
      via: 'PostgreSQL foreign key',
      confidence: 'column',
    },
    {
      id: 'fk.items.product_id',
      kind: 'fk',
      sourceAssetId: 'pg.public.order_items',
      destAssetId: 'pg.public.products',
      sourceColumn: 'product_id',
      destColumn: 'id',
      via: 'PostgreSQL foreign key',
      confidence: 'column',
    },
    {
      id: 'trino.summit_pg',
      kind: 'query_federation',
      sourceAssetId: 'pg.public.orders',
      destAssetId: 'trino.summit_pg',
      via: 'Trino catalog summit_pg',
      confidence: 'dataset',
    },
    {
      id: 'trino.summit_ch',
      kind: 'query_federation',
      sourceAssetId: 'ch.service_kafka.orders',
      destAssetId: 'trino.summit_clickhouse',
      via: 'Trino catalog summit_clickhouse',
      confidence: 'dataset',
    },
    {
      id: 'dh.pg',
      kind: 'metadata',
      sourceAssetId: 'pg.public.customers',
      destAssetId: 'app.datahub-1c8ec127',
      via: 'datahub_metadata_ingestion · metadata only, emit_lineage off',
      confidence: 'dataset',
    },
    {
      id: 'dh.trino',
      kind: 'metadata',
      sourceAssetId: 'trino.trino_catalogs',
      destAssetId: 'app.datahub-1c8ec127',
      via: 'datahub_metadata_ingestion · metadata only, emit_lineage off',
      confidence: 'dataset',
    },
    {
      id: 'crm-app->accounts',
      kind: 'app_write',
      sourceAssetId: 'app.crm-app',
      destAssetId: 'crm.public.accounts',
      via: 'application_service_credential',
      confidence: 'dataset',
    },
    {
      id: 'crm-app->notes',
      kind: 'app_write',
      sourceAssetId: 'app.crm-app',
      destAssetId: 'crm.public.account_notes',
      via: 'application_service_credential',
      confidence: 'dataset',
    },
    {
      id: 'crm-sql->accounts',
      kind: 'app_read',
      sourceAssetId: 'crm.public.accounts',
      destAssetId: 'app.crm-sql',
      via: 'application_service_credential · query editor',
      confidence: 'dataset',
    },
    {
      id: 'crm-sql->notes',
      kind: 'app_read',
      sourceAssetId: 'crm.public.account_notes',
      destAssetId: 'app.crm-sql',
      via: 'application_service_credential · query editor',
      confidence: 'dataset',
    },
    {
      id: 'fk.account_notes.account_id',
      kind: 'fk',
      sourceAssetId: 'crm.public.account_notes',
      destAssetId: 'crm.public.accounts',
      sourceColumn: 'account_id',
      destColumn: 'id',
      via: 'PostgreSQL foreign key',
      confidence: 'column',
    },
  ],
  stacks,
}
