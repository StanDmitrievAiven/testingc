import type { Asset, CatalogSnapshot, Column, LineageEdge } from '../types'
// Explicit extension so catalog.check.ts can import this snapshot under plain node.
import { stacks } from './stacks.ts'

// Column notes are written once on the PostgreSQL source: avroFromPg and chFromAvro copy every
// field, so a note here also describes the CDC topic and the ClickHouse table downstream. Where a
// note claims something about how a column is written, it comes from the captured
// pg_stat_statements workload in src/data/operations.ts rather than from guesswork.
const pgCustomers: Column[] = [
  { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', default: 'nextval', note: 'Surrogate key; orders.customer_id points here' },
  { name: 'email', type: 'text', nullable: false, constraint: 'UQ', note: 'Contact address, and the key the loader upserts on' },
  { name: 'name', type: 'text', nullable: false, note: 'Customer full name; personal data' },
  { name: 'region', type: 'text', nullable: false, note: 'Sales region, the grain campaigns are targeted at' },
  { name: 'country', type: 'text', nullable: false, note: 'Country within the region' },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'Insert time, set by the database' },
  { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'Last write; no UPDATE of this table was captured, so it tracks created_at' },
]

const pgProducts: Column[] = [
  { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', default: 'nextval', note: 'Surrogate key; order_items.product_id points here' },
  { name: 'sku', type: 'text', nullable: false, constraint: 'UQ', note: 'Stock keeping unit, the business key' },
  { name: 'name', type: 'text', nullable: false, note: 'Product display name' },
  { name: 'category', type: 'text', nullable: false, note: 'Merchandising category' },
  { name: 'price', type: 'numeric(10,2)', nullable: false, note: 'Current unit price; order_items.unit_price keeps the price actually charged' },
  { name: 'inventory', type: 'integer', nullable: false, default: '0', note: 'Units in stock, decremented per order item and floored at 0' },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'Insert time, set by the database' },
  { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'Bumped by every price and inventory write' },
]

const pgOrders: Column[] = [
  { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', default: 'nextval', note: 'Surrogate key; order_items.order_id points here' },
  { name: 'customer_id', type: 'bigint', nullable: false, constraint: 'FK', note: 'FK to customers.id' },
  { name: 'status', type: 'text', nullable: false, default: "'pending'", note: 'Lifecycle state, starts at pending and is advanced in place' },
  { name: 'total', type: 'numeric(12,2)', nullable: false, default: '0', note: 'Order value, rewritten once the line items exist' },
  { name: 'region', type: 'text', nullable: false, note: "Copied from the customer's region so reporting need not join" },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'Insert time, set by the database' },
  { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'Bumped by every status and total write' },
]

const pgOrderItems: Column[] = [
  { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', default: 'nextval', note: 'Surrogate key' },
  { name: 'order_id', type: 'bigint', nullable: false, constraint: 'FK', note: 'FK to orders.id' },
  { name: 'product_id', type: 'bigint', nullable: false, constraint: 'FK', note: 'FK to products.id' },
  { name: 'quantity', type: 'integer', nullable: false, note: 'Units ordered; the same amount leaves products.inventory' },
  { name: 'unit_price', type: 'numeric(10,2)', nullable: false, note: 'Price charged at order time, deliberately not the current products.price' },
]

const pgCampaigns: Column[] = [
  { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', default: 'nextval', note: 'Surrogate key' },
  { name: 'name', type: 'text', nullable: false, constraint: 'UQ', note: 'Campaign name, unique' },
  { name: 'region', type: 'text', nullable: false, note: 'Sales region targeted, same vocabulary as customers.region' },
  { name: 'country', type: 'text', nullable: true, note: 'Single-country target; null means the whole region' },
  { name: 'channel', type: 'text', nullable: false, note: 'Channel the campaign runs on' },
  { name: 'start_date', type: 'date', nullable: false, note: 'First day the campaign is live' },
  { name: 'end_date', type: 'date', nullable: false, note: 'Last day the campaign is live' },
  { name: 'discount_pct', type: 'numeric(5,2)', nullable: false, default: '0', note: 'Discount offered, in percent' },
  { name: 'budget_eur', type: 'numeric(12,2)', nullable: false, default: '0', note: 'Planned spend, EUR' },
  { name: 'target_revenue_eur', type: 'numeric(12,2)', nullable: false, default: '0', note: 'Revenue this campaign is meant to bring in, EUR' },
  { name: 'status', type: 'text', nullable: false, default: "'planned'", note: 'Campaign state, starts at planned' },
  { name: 'description', type: 'text', nullable: true, note: 'Free-text brief' },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'Insert time, set by the database' },
  { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'Last edit time' },
]

const crmAccounts: Column[] = [
  { name: 'id', type: 'uuid', nullable: false, constraint: 'PK', default: 'gen_random_uuid()', note: 'Surrogate key, generated by the database' },
  { name: 'name', type: 'text', nullable: false, note: 'Contact person; personal data' },
  { name: 'company', type: 'text', nullable: false, default: "''", note: 'Company the contact works for' },
  { name: 'email', type: 'text', nullable: false, default: "''", note: 'Contact email; personal data, empty when unknown' },
  { name: 'phone', type: 'text', nullable: false, default: "''", note: 'Contact phone; personal data, empty when unknown' },
  { name: 'stage', type: 'text', nullable: false, default: "'lead'", note: 'Pipeline stage, starts at lead' },
  { name: 'value', type: 'integer', nullable: false, default: '0', note: 'Expected deal size, whole currency units' },
  { name: 'notes', type: 'text', nullable: false, default: "''", note: 'Short summary; the running history lives in account_notes' },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'Insert time, set by the database' },
  { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'Last edit time' },
  { name: 'next_action', type: 'text', nullable: false, default: "''", note: 'The next step for this account' },
  // Worth calling out: sorting or filtering by date needs a cast, and bad input fails silently.
  { name: 'follow_up_on', type: 'text', nullable: false, default: "''", note: 'Follow-up date, stored as text rather than a date' },
  { name: 'lost_reason', type: 'text', nullable: false, default: "''", note: 'Why the deal was lost; empty while it is still open' },
]

const crmAccountNotes: Column[] = [
  { name: 'id', type: 'uuid', nullable: false, constraint: 'PK', default: 'gen_random_uuid()', note: 'Surrogate key, generated by the database' },
  { name: 'account_id', type: 'uuid', nullable: false, constraint: 'FK', note: 'FK to accounts.id' },
  { name: 'body', type: 'text', nullable: false, note: 'The note itself' },
  { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()', note: 'When the note was written' },
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
      { name: 'id', type: 'varchar', nullable: false, constraint: 'PK' as const, note: "Marmot's own asset id" },
      { name: 'name', type: 'varchar', nullable: false, note: 'Asset name as displayed' },
      { name: 'mrn', type: 'varchar', nullable: false, note: 'Marmot resource name, the identifier lineage_edges join on' },
      { name: 'type', type: 'varchar', nullable: false, note: 'Asset kind, such as table or topic' },
      { name: 'providers', type: 'text[]', nullable: false, note: 'Systems that reported this asset' },
      { name: 'environments', type: 'jsonb', nullable: false, note: 'Where the asset exists, per environment' },
      { name: 'description', type: 'text', nullable: true, note: 'Description shown in Marmot; null when nobody wrote one' },
      { name: 'metadata', type: 'jsonb', nullable: false, note: 'Everything ingested that has no column of its own' },
      { name: 'schema', type: 'jsonb', nullable: false, note: 'Captured column list, as JSON rather than rows' },
      { name: 'sources', type: 'jsonb', nullable: false, note: 'Which ingestion produced this record' },
      { name: 'tags', type: 'text[]', nullable: false, note: 'Free-form labels' },
      { name: 'query', type: 'text', nullable: true, note: 'Flattened text the search index is built from' },
      { name: 'is_stub', type: 'boolean', nullable: false, note: 'True for an asset only referenced by lineage, never ingested itself' },
      { name: 'created_at', type: 'timestamptz', nullable: false, note: 'First registered' },
      { name: 'updated_at', type: 'timestamptz', nullable: false, note: 'Last re-ingested' },
    ],
  },
  {
    name: 'lineage_edges',
    description: 'Observed or declared lineage between Marmot resource names.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, constraint: 'PK' as const, note: 'Surrogate key' },
      { name: 'source_mrn', type: 'varchar', nullable: false, note: 'Upstream asset, by MRN' },
      { name: 'target_mrn', type: 'varchar', nullable: false, note: 'Downstream asset, by MRN' },
      { name: 'event_id', type: 'uuid', nullable: false, note: 'The lineage event this edge was derived from' },
      { name: 'job_mrn', type: 'varchar', nullable: true, note: 'Job that moved the data; null when only the endpoints are known' },
      { name: 'type', type: 'varchar', nullable: true, note: 'Kind of edge' },
      { name: 'origin', type: 'varchar', nullable: false, note: 'Whether the edge was observed from runtime or declared by hand' },
      { name: 'observation_count', type: 'integer', nullable: false, note: 'Times the edge has been seen; a proxy for confidence' },
      { name: 'last_seen_at', type: 'timestamptz', nullable: false, note: 'Most recent observation, so stale edges are visible' },
    ],
  },
  {
    name: 'data_products',
    description: 'Marmot data product registry.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, constraint: 'PK' as const, note: 'Surrogate key' },
      { name: 'name', type: 'varchar', nullable: false, note: 'Product name' },
      { name: 'description', type: 'text', nullable: true, note: 'What the product offers and to whom' },
      { name: 'metadata', type: 'jsonb', nullable: false, note: 'Ownership and any other free-form fields' },
      { name: 'tags', type: 'text[]', nullable: false, note: 'Free-form labels' },
      { name: 'created_by', type: 'uuid', nullable: true, constraint: 'FK' as const, note: 'Who registered the product; null once that user is deleted' },
      { name: 'membership_count', type: 'integer', nullable: false, note: 'Assets in the product, denormalised for listing' },
    ],
  },
  {
    name: 'glossary_terms',
    description: 'Business glossary used by Marmot.',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, constraint: 'PK' as const, note: 'Surrogate key' },
      { name: 'name', type: 'varchar', nullable: false, note: 'The term itself' },
      { name: 'definition', type: 'text', nullable: false, note: 'Agreed meaning of the term' },
      { name: 'parent_term_id', type: 'uuid', nullable: true, constraint: 'FK' as const, note: 'Broader term; null at the top of the hierarchy' },
      { name: 'tags', type: 'text[]', nullable: true, note: 'Free-form labels' },
    ],
  },
]

/**
 * Marmot's relational core, read from the live service's own `pg_constraint` rather than guessed:
 * 44 of its tables are joined by 61 foreign keys. Key columns only. The schema has 363 columns and
 * documents 8 of them, so expanding all of them would mean inventing 355 descriptions for a tool we
 * do not own, and invented descriptions are worse than an honest gap. Each table's own description
 * says how many columns it really has.
 *
 * Format per column: `name:type:PK|FK|UQ|-:required(r)|nullable(n)`. Notes are derived from the
 * constraints below, so the text cannot drift from the keys it describes.
 */
const marmotRelational: Record<string, [columns: number, keys: string]> = {
  agent_runs: [12, 'id:uuid:PK:r, agent_id:varchar(255):FK:r'],
  agent_tool_calls: [7, 'run_pk:uuid:PK:r, ordinal:integer:PK:r'],
  api_keys: [7, 'id:uuid:PK:r, user_id:uuid:FK:r, name:varchar(255):UQ:r'],
  asset_owners: [5, 'id:uuid:PK:r, asset_id:varchar(255):FK:r, user_id:uuid:FK:n, team_id:uuid:FK:n'],
  asset_rule_memberships: [3, 'asset_rule_id:uuid:PK:r, asset_id:varchar(255):PK:r'],
  asset_rule_targets: [3, 'rule_id:uuid:PK:r, target_type:varchar(50):PK:r, target_value:text:PK:r'],
  asset_rule_terms: [2, 'asset_rule_id:uuid:PK:r, glossary_term_id:uuid:PK:r'],
  asset_rules: [19, 'id:uuid:PK:r, name:varchar(255):UQ:r, created_by:uuid:FK:n'],
  asset_schedules: [4, 'asset_id:varchar(255):PK:r, schedule_id:uuid:PK:r'],
  asset_subscriptions: [6, 'id:uuid:PK:r, asset_id:varchar(255):FK:r, user_id:uuid:FK:r'],
  asset_terms: [5, 'asset_id:varchar(255):PK:r, glossary_term_id:uuid:PK:r, created_by:uuid:FK:n'],
  data_product_memberships: [5, 'data_product_id:uuid:PK:r, asset_id:varchar(255):PK:r, rule_id:uuid:FK:n'],
  data_product_owners: [5, 'id:uuid:PK:r, data_product_id:uuid:FK:r, user_id:uuid:FK:n, team_id:uuid:FK:n'],
  data_product_rule_targets: [
    4,
    'rule_id:uuid:PK:r, data_product_id:uuid:FK:r, target_type:varchar(50):PK:r, target_value:text:PK:r',
  ],
  data_product_rules: [13, 'id:uuid:PK:r, data_product_id:uuid:FK:r, name:varchar(255):-:r'],
  doc_images: [7, 'id:uuid:PK:r, page_id:uuid:FK:r'],
  doc_pages: [12, 'id:uuid:PK:r, parent_id:uuid:FK:n, title:varchar(255):-:r, created_by:uuid:FK:n'],
  glossary_term_owners: [5, 'id:uuid:PK:r, glossary_term_id:uuid:FK:r, user_id:uuid:FK:n, team_id:uuid:FK:n'],
  ingestion_job_runs: [20, 'id:uuid:PK:r, schedule_id:uuid:FK:n, plugin_run_id:uuid:FK:n'],
  ingestion_schedules: [12, 'id:uuid:PK:r, name:varchar(255):UQ:r'],
  lineage_events: [4, 'event_id:uuid:PK:r'],
  notifications: [11, 'id:uuid:PK:r, user_id:uuid:FK:r, title:varchar(255):-:r'],
  permissions: [6, 'id:uuid:PK:r, name:varchar(255):UQ:r'],
  product_images: [9, 'id:uuid:PK:r, data_product_id:uuid:FK:r, created_by:uuid:FK:n'],
  role_permissions: [3, 'role_id:uuid:PK:r, permission_id:uuid:PK:r'],
  roles: [7, 'id:uuid:PK:r, name:varchar(255):-:r'],
  run_checkpoints: [7, 'id:uuid:PK:r, run_id:uuid:FK:r'],
  run_entities: [8, 'id:uuid:PK:r, run_id:uuid:FK:r'],
  run_history: [13, 'id:varchar(255):PK:r, asset_id:varchar(255):FK:r'],
  runs: [11, 'id:uuid:PK:r'],
  service_account_api_keys: [7, 'id:uuid:PK:r, service_account_id:uuid:FK:r, name:varchar(255):UQ:r'],
  service_account_roles: [2, 'service_account_id:uuid:PK:r, role_id:uuid:PK:r'],
  service_accounts: [8, 'id:uuid:PK:r, name:varchar(255):-:r, created_by:uuid:FK:n'],
  sso_team_mappings: [7, 'id:uuid:PK:r, team_id:uuid:FK:r'],
  team_members: [7, 'id:uuid:PK:r, team_id:uuid:FK:r, user_id:uuid:FK:r'],
  team_webhooks: [11, 'id:uuid:PK:r, team_id:uuid:FK:r, name:varchar(255):-:r'],
  teams: [11, 'id:uuid:PK:r, name:varchar(255):UQ:r, created_by:uuid:FK:n'],
  user_identities: [8, 'id:uuid:PK:r, user_id:uuid:FK:r'],
  user_roles: [3, 'user_id:uuid:PK:r, role_id:uuid:PK:r'],
  users: [11, 'id:uuid:PK:r, name:varchar(255):-:r'],
}

/** Every foreign key in the schema, as `[table, column, referenced table, referenced column]`. */
const marmotForeignKeys: [string, string, string, string][] = [
  ['agent_runs', 'agent_id', 'assets', 'id'],
  ['agent_tool_calls', 'run_pk', 'agent_runs', 'id'],
  ['api_keys', 'user_id', 'users', 'id'],
  ['asset_owners', 'asset_id', 'assets', 'id'],
  ['asset_owners', 'team_id', 'teams', 'id'],
  ['asset_owners', 'user_id', 'users', 'id'],
  ['asset_rule_memberships', 'asset_id', 'assets', 'id'],
  ['asset_rule_memberships', 'asset_rule_id', 'asset_rules', 'id'],
  ['asset_rule_targets', 'rule_id', 'asset_rules', 'id'],
  ['asset_rule_terms', 'asset_rule_id', 'asset_rules', 'id'],
  ['asset_rule_terms', 'glossary_term_id', 'glossary_terms', 'id'],
  ['asset_rules', 'created_by', 'users', 'id'],
  ['asset_schedules', 'asset_id', 'assets', 'id'],
  ['asset_schedules', 'schedule_id', 'ingestion_schedules', 'id'],
  ['asset_subscriptions', 'asset_id', 'assets', 'id'],
  ['asset_subscriptions', 'user_id', 'users', 'id'],
  ['asset_terms', 'asset_id', 'assets', 'id'],
  ['asset_terms', 'created_by', 'users', 'id'],
  ['asset_terms', 'glossary_term_id', 'glossary_terms', 'id'],
  ['data_product_memberships', 'asset_id', 'assets', 'id'],
  ['data_product_memberships', 'data_product_id', 'data_products', 'id'],
  ['data_product_memberships', 'rule_id', 'data_product_rules', 'id'],
  ['data_product_owners', 'data_product_id', 'data_products', 'id'],
  ['data_product_owners', 'team_id', 'teams', 'id'],
  ['data_product_owners', 'user_id', 'users', 'id'],
  ['data_product_rule_targets', 'data_product_id', 'data_products', 'id'],
  ['data_product_rule_targets', 'rule_id', 'data_product_rules', 'id'],
  ['data_product_rules', 'data_product_id', 'data_products', 'id'],
  ['data_products', 'created_by', 'users', 'id'],
  ['doc_images', 'page_id', 'doc_pages', 'id'],
  ['doc_pages', 'created_by', 'users', 'id'],
  ['doc_pages', 'parent_id', 'doc_pages', 'id'],
  ['glossary_term_owners', 'glossary_term_id', 'glossary_terms', 'id'],
  ['glossary_term_owners', 'team_id', 'teams', 'id'],
  ['glossary_term_owners', 'user_id', 'users', 'id'],
  ['glossary_terms', 'parent_term_id', 'glossary_terms', 'id'],
  ['ingestion_job_runs', 'plugin_run_id', 'runs', 'id'],
  ['ingestion_job_runs', 'schedule_id', 'ingestion_schedules', 'id'],
  ['lineage_edges', 'event_id', 'lineage_events', 'event_id'],
  ['lineage_edges', 'source_mrn', 'assets', 'mrn'],
  ['lineage_edges', 'target_mrn', 'assets', 'mrn'],
  ['notifications', 'user_id', 'users', 'id'],
  ['product_images', 'created_by', 'users', 'id'],
  ['product_images', 'data_product_id', 'data_products', 'id'],
  ['role_permissions', 'permission_id', 'permissions', 'id'],
  ['role_permissions', 'role_id', 'roles', 'id'],
  ['run_checkpoints', 'run_id', 'runs', 'id'],
  ['run_entities', 'run_id', 'runs', 'id'],
  ['run_history', 'asset_id', 'assets', 'id'],
  ['service_account_api_keys', 'service_account_id', 'service_accounts', 'id'],
  ['service_account_roles', 'role_id', 'roles', 'id'],
  ['service_account_roles', 'service_account_id', 'service_accounts', 'id'],
  ['service_accounts', 'created_by', 'users', 'id'],
  ['sso_team_mappings', 'team_id', 'teams', 'id'],
  ['team_members', 'team_id', 'teams', 'id'],
  ['team_members', 'user_id', 'users', 'id'],
  ['team_webhooks', 'team_id', 'teams', 'id'],
  ['teams', 'created_by', 'users', 'id'],
  ['user_identities', 'user_id', 'users', 'id'],
  ['user_roles', 'role_id', 'roles', 'id'],
  ['user_roles', 'user_id', 'users', 'id'],
]

/** What a key column is for, said in terms of the constraint it carries and nothing more. */
function marmotColumns(table: string): Column[] {
  const specs = marmotRelational[table][1].split(', ').map((spec) => spec.split(':'))
  const composite = specs.filter(([, , role]) => role === 'PK').length > 1
  return specs.map(([name, type, role, required]) => {
    const references = marmotForeignKeys.find(([from, column]) => from === table && column === name)
    const said = [
      role === 'PK' ? (composite ? 'Part of the composite primary key' : 'Primary key') : '',
      role === 'UQ' ? 'Unique' : '',
      references ? `references ${references[2]}.${references[3]}` : '',
      role === '-' && !references ? `The ${name} shown in Marmot` : '',
    ].filter(Boolean)
    return {
      name,
      type,
      nullable: required === 'n',
      constraint: role === '-' ? undefined : (role as 'PK' | 'FK' | 'UQ'),
      // Capitalised once, at the front, so "Primary key, references users.id." reads as one sentence.
      note: `${said.join(', ')}.`,
    }
  })
}

/**
 * Tables that hold keys or secrets rather than describe them. The tag rides with the table, so an
 * agent reading the catalog is told to keep out at the point it would otherwise start reading:
 * `agent-blocked` is worth nothing as a vocabulary entry nothing is ever tagged with.
 */
const secretBearing = new Set(['api_keys', 'service_account_api_keys', 'system_secrets'])

const marmotTags = (name: string): string[] =>
  secretBearing.has(name) ? ['marmot', 'credentials', 'agent-blocked'] : ['marmot']

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

/**
 * Databases and schemas have no entity in the snapshot — they exist only as folders the tree
 * derives from `asset.schema`, so this is the one place their prose can live. Keyed by the
 * `service:folder` ids catalogTree builds; catalog.check.ts asserts every key names a real
 * service and schema, since a typo would silently fall back to the generic line.
 */
export const folderDescriptions: Record<string, string> = {
  'pg-37c7de3b:defaultdb':
    'Aiven creates defaultdb with every PostgreSQL service. Here it carries both the webshop tables in public and campaign planning in marketing.',
  'pg-37c7de3b:public':
    'Webshop system of record: customers, products, orders and line items. Every table here is captured by the webshop-pg-cdc connector into webshop.public.* topics.',
  'pg-37c7de3b:marketing':
    'Campaign planning, deliberately kept out of the webshop schema. No CDC runs on it; ClickHouse reads these rows live over clickhouse_postgresql instead.',
  'kafka-1b5cb1e7:webshop.public':
    'CDC topics for the four webshop tables. Debezium names them after its topic.prefix, so the namespace is webshop plus the source schema. Values are Avro, with subjects in the Schema Registry.',
  'clickhouse-2a6274d2:service_kafka-1b5cb1e7':
    'Kafka engine tables Aiven maintains for the clickhouse_kafka integration, in a database named after the Kafka service. These consume from the topics, so selecting from one directly advances the consumer group rather than just reading it.',
  'clickhouse-2a6274d2:service_pg-37c7de3b.marketing':
    'PostgreSQL engine tables from the clickhouse_postgresql integration, named after the source service and schema. Queries are pushed down to Postgres on every read; ClickHouse stores nothing here.',
  'trino-hub-pg:defaultdb':
    'Aiven creates defaultdb with every PostgreSQL service. Here it carries only the Trino hub control plane in public.',
  'trino-hub-pg:public':
    'Trino hub control plane: which catalogs exist, who and what may query them, and an audit trail of what ran. Federated query results never land here.',
  'marmot-pg:defaultdb':
    "Aiven creates defaultdb with every PostgreSQL service. Here it carries Marmot's whole schema in public.",
  'marmot-pg:public':
    'The Marmot catalog schema: 44 of its 57 tables are joined by 61 foreign keys, which the data model view draws. Four tables are expanded in full — assets, lineage_edges, data_products and glossary_terms; the rest keep their key columns, and the 13 tables with no keys are listed by name only.',
  'analytics-agent-pg:defaultdb':
    'Aiven creates defaultdb with every PostgreSQL service. Here it carries the analytics agent store in public.',
  'analytics-agent-pg:public':
    'Analytics agent store: conversations and the events inside them, plus the integrations and context platforms the agent is allowed to reach.',
  'crm-pg:defaultdb':
    'Aiven creates defaultdb with every PostgreSQL service. Here it carries the CRM tables in public.',
  'crm-pg:public':
    'CRM system of record: accounts with their pipeline stage, and free-text notes against them. Written by crm-app and queried by crm-sql.',
}

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
    { id: 'crm-pg', name: 'crm-pg', type: 'pg', state: 'RUNNING', role: 'CRM system of record', plan: 'hobbyist', version: '17.11', cloud: 'aws-eu-west-1' },
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
      // These "columns" are connector settings, with the configured value in the type field.
      columns: [
        { name: 'connector.class', type: 'io.debezium.connector.postgresql.PostgresConnector', note: 'Debezium implementation doing the capture' },
        { name: 'plugin.name', type: 'pgoutput', note: "Logical decoding output plugin, built into Postgres so nothing extra is installed" },
        { name: 'slot.name', type: 'debezium_webshop', note: 'Replication slot; it holds WAL on the source while the connector is down' },
        { name: 'topic.prefix', type: 'webshop', note: 'Prefixes every topic this connector writes, hence webshop.public.*' },
        { name: 'snapshot.mode', type: 'initial', note: 'Snapshot the tables once, then stream changes' },
        { name: 'decimal.handling.mode', type: 'string', note: 'Why numeric columns arrive downstream as strings rather than bytes' },
      ],
      tags: ['cdc', 'running'],
    },

    table('ch.service_kafka.customers', 'customers', 'clickhouse-2a6274d2', 'service_kafka-1b5cb1e7', 'ClickHouse Kafka engine table. Group ch-webshop-customers-avro-v1, AvroConfluent, offset latest.', chFromAvro(kafkaCustomers), { kind: 'clickhouse_table', tags: ['cdc', 'avro'] }),
    table('ch.service_kafka.products', 'products', 'clickhouse-2a6274d2', 'service_kafka-1b5cb1e7', 'ClickHouse Kafka engine table for product CDC.', chFromAvro(kafkaProducts), { kind: 'clickhouse_table', tags: ['cdc', 'avro'] }),
    table('ch.service_kafka.orders', 'orders', 'clickhouse-2a6274d2', 'service_kafka-1b5cb1e7', 'ClickHouse Kafka engine table for order CDC.', chFromAvro(kafkaOrders), { kind: 'clickhouse_table', tags: ['cdc', 'avro'] }),
    table('ch.service_kafka.order_items', 'order_items', 'clickhouse-2a6274d2', 'service_kafka-1b5cb1e7', 'ClickHouse Kafka engine table for order item CDC.', chFromAvro(kafkaOrderItems), { kind: 'clickhouse_table', tags: ['cdc', 'avro'] }),
    table('ch.pg.marketing.campaigns', 'campaigns', 'clickhouse-2a6274d2', 'service_pg-37c7de3b.marketing', 'PostgreSQL engine over marketing.campaigns via clickhouse_postgresql.', pgCampaigns.map((c) => ({ ...c, note: c.note ?? 'Federated from PostgreSQL' })), { kind: 'clickhouse_table', rowCount: 16, tags: ['marketing', 'federation'] }),

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
      { name: 'id', type: 'varchar', nullable: false, constraint: 'PK', note: 'Conversation id; messages.conversation_id points here' },
      { name: 'title', type: 'varchar', nullable: false, note: 'Conversation title shown in the app' },
      { name: 'engine_name', type: 'varchar', nullable: false, note: 'Engine that answered, so replies can be compared across models' },
      { name: 'created_at', type: 'timestamptz', nullable: false, note: 'When the conversation started' },
      { name: 'updated_at', type: 'timestamptz', nullable: false, note: 'Time of the most recent message' },
      { name: 'quality_score', type: 'integer', nullable: true, note: 'Answer rating; null until the conversation is scored' },
      { name: 'quality_label', type: 'varchar', nullable: true, note: 'Score as a bucket rather than a number' },
      { name: 'quality_reason', type: 'text', nullable: true, note: 'Why that score was given' },
    ], { tags: ['app'] }),
    table('agent.messages', 'messages', 'analytics-agent-pg', 'public', 'Conversation events for the analytics agent.', [
      { name: 'id', type: 'varchar', nullable: false, constraint: 'PK', note: 'Event id' },
      { name: 'conversation_id', type: 'varchar', nullable: false, constraint: 'FK', note: 'FK to conversations.id' },
      { name: 'event_type', type: 'varchar', nullable: false, note: 'Kind of event; the table holds more than plain messages' },
      { name: 'role', type: 'varchar', nullable: false, note: 'Who produced it: user, assistant or system' },
      { name: 'payload', type: 'text', nullable: false, note: 'Event body, JSON held as text' },
      { name: 'sequence', type: 'integer', nullable: false, note: 'Order within the conversation; sort on this, not on created_at' },
      { name: 'created_at', type: 'timestamptz', nullable: false, note: 'When the event was recorded' },
    ], { tags: ['app'] }),
    table('agent.integrations', 'integrations', 'analytics-agent-pg', 'public', 'Configured agent integrations.', [
      { name: 'id', type: 'varchar', nullable: false, constraint: 'PK', note: 'Integration id' },
      { name: 'name', type: 'varchar', nullable: false, note: 'Internal name' },
      { name: 'type', type: 'varchar', nullable: false, note: 'Which kind of system this connects to' },
      { name: 'label', type: 'varchar', nullable: false, note: 'Name shown in the app' },
      { name: 'config', type: 'text', nullable: false, note: 'Connection settings, JSON held as text' },
      { name: 'source', type: 'varchar', nullable: false, note: 'Whether it was configured in the app or provisioned for it' },
    ], { tags: ['app'] }),
    table('agent.context_platforms', 'context_platforms', 'analytics-agent-pg', 'public', 'Context platforms the agent can query.', [
      { name: 'id', type: 'varchar', nullable: false, constraint: 'PK', note: 'Platform id' },
      { name: 'type', type: 'varchar', nullable: false, note: 'Kind of platform the agent can ask for context' },
      { name: 'name', type: 'varchar', nullable: false, note: 'Internal name' },
      { name: 'label', type: 'varchar', nullable: false, note: 'Name shown in the app' },
      { name: 'config', type: 'text', nullable: false, note: 'Connection settings, JSON held as text' },
      { name: 'source', type: 'varchar', nullable: false, note: 'Whether it was configured in the app or provisioned for it' },
    ], { tags: ['app'] }),
    table('agent.settings', 'settings', 'analytics-agent-pg', 'public', 'Key-value settings for the analytics agent.', [
      { name: 'key', type: 'varchar', nullable: false, constraint: 'PK', note: 'Setting name, one row per setting' },
      { name: 'value', type: 'text', nullable: true, note: 'Setting value; null means unset rather than false' },
      { name: 'updated_at', type: 'timestamptz', nullable: false, note: 'When the setting last changed' },
    ], { tags: ['app'] }),

    table('crm.public.accounts', 'accounts', 'crm-pg', 'public', 'CRM accounts and pipeline stages. Written by crm-app.', crmAccounts, { rowCount: 2, tags: ['crm', 'pii'] }),
    table('crm.public.account_notes', 'account_notes', 'crm-pg', 'public', 'Free-text notes per account. FK to accounts.', crmAccountNotes, { rowCount: 2, tags: ['crm'] }),

    table('trino.trino_catalogs', 'trino_catalogs', 'trino-hub-pg', 'public', 'Registered Trino catalogs.', [
      { name: 'id', type: 'integer', nullable: false, constraint: 'PK', note: 'Surrogate key' },
      { name: 'name', type: 'varchar', nullable: false, note: 'Catalog name as queried in SQL: summit_pg, summit_clickhouse' },
      { name: 'properties', type: 'jsonb', nullable: false, note: 'Connector properties; this is where the federation is actually configured' },
      { name: 'created_at', type: 'timestamptz', nullable: true, note: 'When the catalog was registered' },
    ], { tags: ['control-plane'] }),
    table('trino.trino_audit_events', 'trino_audit_events', 'trino-hub-pg', 'public', 'Trino query and actor audit log.', [
      { name: 'id', type: 'bigint', nullable: false, constraint: 'PK', note: 'Surrogate key' },
      { name: 'actor_type', type: 'varchar', nullable: false, note: 'Whether a person or a machine account acted' },
      { name: 'actor_id', type: 'varchar', nullable: false, note: 'Who acted' },
      { name: 'action', type: 'varchar', nullable: false, note: 'What they did' },
      { name: 'query_hash', type: 'text', nullable: true, note: 'Hash of the SQL, not the SQL itself, so the text cannot be recovered' },
      { name: 'created_at', type: 'timestamptz', nullable: false, note: 'When it happened' },
    ], { tags: ['control-plane'] }),
    table('trino.trino_kafka_config', 'trino_kafka_config', 'trino-hub-pg', 'public', 'Kafka connector configuration blob for Trino.', [
      { name: 'id', type: 'integer', nullable: false, constraint: 'PK', note: 'Surrogate key' },
      { name: 'config_text', type: 'text', nullable: false, note: 'Connector config kept verbatim, not parsed into columns' },
      { name: 'created_at', type: 'timestamptz', nullable: true, note: 'When the config was stored' },
    ], { tags: ['control-plane'] }),
    table('trino.trino_users', 'trino_users', 'trino-hub-pg', 'public', 'Trino hub users.', [
      { name: 'id', type: 'uuid', nullable: false, constraint: 'PK', note: 'Surrogate key' },
      { name: 'username', type: 'varchar', nullable: false, note: 'Login name' },
      { name: 'role', type: 'varchar', nullable: false, note: 'Permission role granted in the hub' },
      { name: 'enabled', type: 'boolean', nullable: false, note: 'False blocks sign-in without deleting the user' },
    ], { tags: ['control-plane'] }),
    table('trino.trino_mcp_api_keys', 'trino_mcp_api_keys', 'trino-hub-pg', 'public', 'API keys for the Trino MCP server.', [
      { name: 'id', type: 'uuid', nullable: false, constraint: 'PK', note: 'Surrogate key' },
      { name: 'name', type: 'varchar', nullable: false, note: 'Label describing what the key is for' },
      { name: 'role', type: 'varchar', nullable: false, note: 'Permissions the key carries' },
      { name: 'enabled', type: 'boolean', nullable: false, note: 'False suspends the key' },
      { name: 'revoked_at', type: 'timestamptz', nullable: true, note: 'Set when the key was revoked for good; null while it is usable' },
    ], { tags: ['control-plane', 'credentials', 'agent-blocked'] }),

    ...marmotCoreTables.map((t) =>
      table(`marmot.${t.name}`, t.name, 'marmot-pg', 'public', t.description, t.columns, { tags: marmotTags(t.name) }),
    ),
    ...marmotTableNames.map((name) =>
      marmotRelational[name]
        ? table(
            `marmot.${name}`,
            name,
            'marmot-pg',
            'public',
            `Marmot catalog table ${name}. ${marmotRelational[name][0]} columns in the database; the snapshot keeps its key columns, which are what the data model is drawn from.`,
            marmotColumns(name),
            { tags: marmotTags(name) },
          )
        : table(`marmot.${name}`, name, 'marmot-pg', 'public', `Marmot catalog table ${name}. No keys and no column list in this snapshot: nothing references it and it references nothing.`, [], { tags: marmotTags(name) }),
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
    // Marmot's own foreign keys, so its schema has a data model like any other database here.
    ...marmotForeignKeys.map(([from, column, to, references]) => ({
      id: `fk.marmot.${from}.${column}`,
      kind: 'fk' as const,
      sourceAssetId: `marmot.${from}`,
      destAssetId: `marmot.${to}`,
      sourceColumn: column,
      destColumn: references,
      via: 'PostgreSQL foreign key',
      confidence: 'column' as const,
    })),
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
