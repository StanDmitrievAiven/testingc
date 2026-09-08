// Read-only operational snapshot of project data-innovation-summit, captured from the Aiven API
// via MCP on 2026-09-07. Same premise as src/data/catalog.ts: the app ships the capture, so the
// prototype works with no credentials and changes nothing upstream.
//
// Sources, one per export:
//   serviceEvents  aiven_project_get_event_logs        (kept: events for services this catalog holds)
//   queryStats     aiven_pg_service_query_statistics   (kept: queries touching catalogued tables)
//   topicHealth    aiven_kafka_topic_get               (one call per topic; offsets are point-in-time)
//   serviceFacts   aiven_service_get                   (only the four services the demo walks through)
// Imported by relative path, not the `@/` alias, so src/lib/operations.check.ts runs under plain node.
import type { QueryStat, ServiceEvent, ServiceFacts, TopicHealth } from '../types.ts'

export const operationsCapturedAt = '2026-09-07T07:20:00Z'

/**
 * Aiven's account of what happened to each service, which is a different question from the purpose
 * log's "why did someone ask for it". Note the `Aiven Automation` actors: those are failovers and
 * maintenance no agent triggered, so no purpose log can ever contain them.
 */
export const serviceEvents: ServiceEvent[] = [
  { id: 'pe5db36ddcfc9', serviceId: 'crm-sql', at: '2026-09-04T10:21:04Z', actor: 'stan.dmitriev@aiven.io', type: 'service_create', description: "Created 'application' service 'crm-sql' with plan 'startup-50-1024' in cloud 'aws-eu-west-1'" },
  { id: 'pe5db313edba8', serviceId: 'crm-app', at: '2026-09-04T08:51:23Z', actor: 'stan.dmitriev@aiven.io', type: 'service_create', description: "Created 'application' service 'crm-app' with plan 'startup-50-1024' in cloud 'aws-eu-west-1'" },
  { id: 'pe5db30d2d1d3', serviceId: 'crm-pg', at: '2026-09-04T08:44:34Z', actor: 'Aiven Automation', type: 'service_master_promotion', description: 'Promoted crm-pg-1 to be the new master in service crm-pg.' },
  { id: 'pe5db30a64827', serviceId: 'crm-pg', at: '2026-09-04T08:42:20Z', actor: 'stan.dmitriev@aiven.io', type: 'service_create', description: "Created 'pg' service 'crm-pg' with plan 'hobbyist' in cloud 'aws-eu-west-1'" },
  { id: 'pe5dae2c946f1', serviceId: 'datahub-1c8ec127-kafka', at: '2026-09-03T11:56:29Z', actor: 'valtteri.juvonen@aiven.io', type: 'service_maintenance_perform', description: 'Applied maintenance updates: Add new AMQP Connector for Apache Kafka (Early Access, version 0.1.0); Update Aiven BigQuery Sink Connector for Apache Kafka to version 2.13.0; Add new Salesforce Sink Connector for Apache Kafka (Early Access, version 0.3.0); Fix num_partitions regression for auto-topic creation in KRaft mode in clusters updated after May 25th; Add Azure Key Vault secret provider support for Kafka Connect; Upgrade Karapace to version 6.2.2.; Security Patch; Update Aiven OpenSearch Sink Connector for Apache Kafka to version 3.2.0' },
  { id: 'pe5dac46ebbde', serviceId: 'analytics-agent-pg', at: '2026-09-03T03:49:35Z', actor: 'Aiven Automation', type: 'service_master_promotion', description: 'Promoted analytics-agent-pg-2 to be the new master in service analytics-agent-pg.' },
  { id: 'pe5dac41858e8', serviceId: 'analytics-agent-pg', at: '2026-09-03T03:44:43Z', actor: 'Aiven Operations', type: 'service_maintenance_perform', description: 'Applied maintenance updates: Security fix for postgis extension; Security Patch; Upgrade to PostgreSQL® 17.11 bugfix release; Security fix for flatgeobuf RCE in postgis extension; TimescaleDB version 2.29.2 is available.' },
  { id: 'pe5da3d855091', serviceId: 'managed-agents-e55f68a7-db', at: '2026-09-01T15:51:32Z', actor: 'Aiven Automation', type: 'service_master_promotion', description: 'Promoted managed-agents-e55f68a7-db-2 to be the new master in service managed-agents-e55f68a7-db.' },
  { id: 'pe5da3d59c7d8', serviceId: 'managed-agents-e55f68a7-db', at: '2026-09-01T15:48:44Z', actor: 'Aiven Operations', type: 'service_maintenance_perform', description: 'Applied maintenance updates: Security fix for postgis extension; Security Patch; Upgrade to PostgreSQL® 17.11 bugfix release; Security patch with fixes for potential vulnerabilities.' },
  { id: 'pe5da183aa787', serviceId: 'clickhouse-2a6274d2', at: '2026-09-01T05:55:02Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_integration_create', description: 'Created integration datahub_metadata_ingestion (402aeb4f) to service datahub-ayes-test-1' },
  { id: 'pe5d9cf57efd5', serviceId: 'pg-37c7de3b', at: '2026-08-31T10:29:27Z', actor: 'Aiven Automation', type: 'service_master_promotion', description: 'Promoted pg-37c7de3b-8 to be the new master in service pg-37c7de3b.' },
  { id: 'pe5d9cf5f38c4', serviceId: 'marmot-pg', at: '2026-08-31T10:29:11Z', actor: 'Aiven Automation', type: 'service_master_promotion', description: 'Promoted marmot-pg-4 to be the new master in service marmot-pg.' },
  { id: 'pe5d9cf5b7066', serviceId: 'trino-hub-pg', at: '2026-08-31T10:29:11Z', actor: 'Aiven Automation', type: 'service_master_promotion', description: 'Promoted trino-hub-pg-4 to be the new master in service trino-hub-pg.' },
  { id: 'pe5d9cf22a7d8', serviceId: 'clickhouse-2a6274d2', at: '2026-08-31T10:26:05Z', actor: 'stan.dmitriev@aiven.io', type: 'service_update', description: "Migrated service from 'aws-eu-west-1' to 'aws-eu-west-1' (VPC 'fafac515')" },
  { id: 'pe5d9cf295e01', serviceId: 'pg-37c7de3b', at: '2026-08-31T10:26:04Z', actor: 'stan.dmitriev@aiven.io', type: 'service_update', description: "Migrated service from 'aws-eu-west-1' to 'aws-eu-west-1' (VPC 'fafac515')" },
  { id: 'pe5d9cf28cc1e', serviceId: 'trino-hub-pg', at: '2026-08-31T10:26:04Z', actor: 'stan.dmitriev@aiven.io', type: 'service_update', description: "Migrated service from 'aws-eu-west-1' to 'aws-eu-west-1' (VPC 'fafac515')" },
  { id: 'pe5d9cf292718', serviceId: 'marmot-pg', at: '2026-08-31T10:26:04Z', actor: 'stan.dmitriev@aiven.io', type: 'service_update', description: "Migrated service from 'aws-eu-west-1' to 'aws-eu-west-1' (VPC 'fafac515')" },
  { id: 'pe5d9cf291f0b', serviceId: 'pg-37c7de3b', at: '2026-08-31T10:25:34Z', actor: 'stan.dmitriev@aiven.io', type: 'service_maintenance_perform', description: 'Applied maintenance updates: Upgrade to PostgreSQL® 17.11 bugfix release; Security fix for flatgeobuf RCE in postgis extension; Security patch with fixes for potential vulnerabilities; TimescaleDB version 2.29.2 is available.' },
  { id: 'pe5d9cf236241', serviceId: 'clickhouse-2a6274d2', at: '2026-08-31T10:25:34Z', actor: 'stan.dmitriev@aiven.io', type: 'service_maintenance_perform', description: 'Applied maintenance updates: Security Patch; Added support for SQL Named Collections.; Update ClickHouse to version 25.8.31.9.' },
  { id: 'pe5d9cf2b6db5', serviceId: 'marmot-pg', at: '2026-08-31T10:25:34Z', actor: 'stan.dmitriev@aiven.io', type: 'service_maintenance_perform', description: 'Applied maintenance updates: TimescaleDB version 2.29.2 is available.' },
  { id: 'pe5d9ca3064ba', serviceId: 'kafka-1b5cb1e7', at: '2026-08-31T09:07:07Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_update', description: "Created Schema Registry ACL entry {'permission': 'schema_registry_write', 'resource': 'Subject:*', 'username': 'avnadmin'}" },
  { id: 'pe5d9ca33c873', serviceId: 'kafka-1b5cb1e7', at: '2026-08-31T09:06:52Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_update', description: "Created ACL entry {'permission': 'readwrite', 'topic': '*', 'username': 'avnadmin'}" },
  { id: 'pe5d9c930fe70', serviceId: 'kafka-1b5cb1e7', at: '2026-08-31T08:50:56Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_integration_create', description: 'Created integration datahub_metadata_ingestion (2e9d17d0) to service datahub-ayes-test-1' },
  { id: 'pe5d9c93e3adb', serviceId: 'kafkaconnect-30e121dd', at: '2026-08-31T08:50:56Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_integration_create', description: 'Created integration datahub_metadata_ingestion (859b6fb6) to service datahub-ayes-test-1' },
  { id: 'pe5d9c93195e6', serviceId: 'pg-37c7de3b', at: '2026-08-31T08:50:56Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_integration_create', description: 'Created integration datahub_metadata_ingestion (84fde568) to service datahub-ayes-test-1' },
  { id: 'pe5d9670a79a5', serviceId: 'trino-hub-pg', at: '2026-08-30T06:39:31Z', actor: 'Aiven Automation', type: 'service_master_promotion', description: 'Promoted trino-hub-pg-2 to be the new master in service trino-hub-pg.' },
  { id: 'pe5d966d8d048', serviceId: 'trino-hub-pg', at: '2026-08-30T06:36:44Z', actor: 'Aiven Operations', type: 'service_maintenance_perform', description: 'Applied maintenance updates: TimescaleDB version 2.29.1 is available.; Upgrade to PostgreSQL® 17.11 bugfix release; Security patch with fixes for potential vulnerabilities.' },
  { id: 'pe5d868b67f82', serviceId: 'clickhouse-2a6274d2', at: '2026-08-27T10:50:51Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_integration_create', description: 'Created integration datahub_metadata_ingestion (36839091) to service datahub-ayea-test-2' },
  { id: 'pe5d868bf4f74', serviceId: 'kafka-1b5cb1e7', at: '2026-08-27T10:50:51Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_integration_create', description: 'Created integration datahub_metadata_ingestion (ea0de0d9) to service datahub-ayea-test-2' },
  { id: 'pe5d868b3cd6a', serviceId: 'kafka-1b5cb1e7', at: '2026-08-27T10:50:51Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_update', description: "Created service user 'datahub_ingestion_d6aa07044dc4'" },
  { id: 'pe5d7b421593e', serviceId: 'clickhouse-2a6274d2', at: '2026-08-25T10:41:49Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_integration_create', description: 'Created integration datahub_metadata_ingestion (57f5af6c) to service datahub-ayea-test-2' },
  { id: 'pe5d7b42d817c', serviceId: 'pg-37c7de3b', at: '2026-08-25T10:41:49Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_integration_create', description: 'Created integration datahub_metadata_ingestion (3aa85c47) to service datahub-ayea-test-2' },
  { id: 'pe5d7b42341cc', serviceId: 'kafkaconnect-30e121dd', at: '2026-08-25T10:41:49Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_integration_create', description: 'Created integration datahub_metadata_ingestion (063d0ed4) to service datahub-ayea-test-2' },
  { id: 'pe5d7b42834c9', serviceId: 'kafka-1b5cb1e7', at: '2026-08-25T10:41:49Z', actor: 'ayesha.ahmad@aiven.io', type: 'service_integration_create', description: 'Created integration datahub_metadata_ingestion (25b4f00c) to service datahub-ayea-test-2' },
]

/**
 * Total query time the service has spent since `pg_stat_statements` was last reset, across all 83
 * recorded statements. Held separately because the rows below are only the ones that touch a
 * catalogued table, and a share of the whole is the honest way to read them.
 */
export const totalQueryTimeMs = 153505739

export const queryStats: QueryStat[] = [
  {
    id: 'orders-status-sample',
    serviceId: 'pg-37c7de3b',
    tables: ['orders'],
    sql: 'SELECT id, status FROM orders\n  WHERE status IN ($1, $2, $3)\n  ORDER BY random()\n  LIMIT $4',
    calls: 43612,
    meanMs: 1985.247,
    maxMs: 3467.187,
    totalMs: 86580571.573,
  },
  {
    id: 'customers-region-sample',
    serviceId: 'pg-37c7de3b',
    tables: ['customers'],
    sql: 'SELECT id, region FROM customers\n  ORDER BY random()\n  LIMIT $1',
    calls: 306354,
    meanMs: 217.319,
    maxMs: 478.373,
    totalMs: 66576525.371,
  },
  {
    id: 'orders-insert',
    serviceId: 'pg-37c7de3b',
    tables: ['orders'],
    sql: 'INSERT INTO orders (customer_id, status, total, region)\n  VALUES ($1, $3, $4, $2)\n  RETURNING id',
    calls: 306354,
    meanMs: 0.304,
    maxMs: 35.977,
    totalMs: 93123.073,
  },
  {
    id: 'order-items-insert',
    serviceId: 'pg-37c7de3b',
    tables: ['order_items'],
    sql: 'INSERT INTO order_items (order_id, product_id, quantity, unit_price)\n  VALUES ($1, $2, $3, $4)',
    calls: 765435,
    meanMs: 0.103,
    maxMs: 6.792,
    totalMs: 78762.743,
  },
  {
    id: 'orders-status-update',
    serviceId: 'pg-37c7de3b',
    tables: ['orders'],
    sql: 'UPDATE orders SET status = $1, updated_at = now() WHERE id = $2',
    calls: 43611,
    meanMs: 0.926,
    maxMs: 18.805,
    totalMs: 40392.827,
  },
  {
    id: 'customers-upsert',
    serviceId: 'pg-37c7de3b',
    tables: ['customers'],
    sql: 'INSERT INTO customers (email, name, region, country)\n  VALUES ($1, $2, $3, $4)\n  ON CONFLICT (email) DO NOTHING',
    calls: 43795,
    meanMs: 0.603,
    maxMs: 16.593,
    totalMs: 26415.37,
  },
  {
    id: 'orders-total-update',
    serviceId: 'pg-37c7de3b',
    tables: ['orders'],
    sql: 'UPDATE orders\n  SET total = $1, updated_at = now()\n  WHERE id = $2',
    calls: 306354,
    meanMs: 0.066,
    maxMs: 2.126,
    totalMs: 20114.713,
  },
  {
    id: 'products-inventory-decrement',
    serviceId: 'pg-37c7de3b',
    tables: ['products'],
    sql: 'UPDATE products\n  SET inventory = GREATEST(inventory - $1, $3),\n      updated_at = now()\n  WHERE id = $2',
    calls: 765435,
    meanMs: 0.026,
    maxMs: 10.048,
    totalMs: 20045.777,
  },
  {
    id: 'products-price-sample',
    serviceId: 'pg-37c7de3b',
    tables: ['products'],
    sql: 'SELECT id, price FROM products\n  ORDER BY random()\n  LIMIT $1',
    calls: 306354,
    meanMs: 0.042,
    maxMs: 1.826,
    totalMs: 12958.316,
  },
  {
    id: 'customers-full-scan',
    serviceId: 'pg-37c7de3b',
    tables: ['customers'],
    sql: 'SELECT id, region FROM customers',
    calls: 2,
    meanMs: 2502.228,
    maxMs: 2702.946,
    totalMs: 5004.457,
  },
  {
    id: 'orders-count',
    serviceId: 'pg-37c7de3b',
    tables: ['orders'],
    sql: 'SELECT count(*)::text AS count FROM orders',
    calls: 2,
    meanMs: 1131.592,
    maxMs: 1971.904,
    totalMs: 2263.184,
  },
  {
    id: 'products-inventory-restock',
    serviceId: 'pg-37c7de3b',
    tables: ['products'],
    sql: 'UPDATE products\n  SET inventory = inventory + $1,\n      updated_at = now()\n  WHERE id = (SELECT id FROM products ORDER BY random() LIMIT $2)',
    calls: 21763,
    meanMs: 0.08,
    maxMs: 3.086,
    totalMs: 1733.262,
  },
  {
    id: 'products-price-update',
    serviceId: 'pg-37c7de3b',
    tables: ['products'],
    sql: 'UPDATE products\n  SET price = ROUND(price * $1::numeric, $2),\n      updated_at = now()\n  WHERE id = (SELECT id FROM products ORDER BY random() LIMIT $3)',
    calls: 21810,
    meanMs: 0.077,
    maxMs: 3.475,
    totalMs: 1679.885,
  },
  {
    id: 'customers-count',
    serviceId: 'pg-37c7de3b',
    tables: ['customers'],
    sql: 'SELECT count(*)::text AS count FROM customers',
    calls: 2,
    meanMs: 126.621,
    maxMs: 183.256,
    totalMs: 253.242,
  },
]

/** Offsets move constantly, so these are a point-in-time read, not a live gauge. */
export const topicHealth: TopicHealth[] = [
  {
    assetId: 'kafka.webshop.public.orders',
    consumerGroup: 'ch-webshop-orders-avro-v1',
    retentionHours: 168,
    replication: 3,
    minInsyncReplicas: 1,
    partitions: [
      { partition: 0, earliestOffset: 4141299, latestOffset: 4589765, consumerOffset: 4589760, sizeBytes: 81428480, isr: 3 },
      { partition: 1, earliestOffset: 4142087, latestOffset: 4588338, consumerOffset: 4588338, sizeBytes: 81051648, isr: 3 },
      { partition: 2, earliestOffset: 4140513, latestOffset: 4587897, consumerOffset: 4587897, sizeBytes: 81272832, isr: 3 },
    ],
  },
  {
    assetId: 'kafka.webshop.public.customers',
    consumerGroup: 'ch-webshop-customers-avro-v1',
    retentionHours: 168,
    replication: 3,
    minInsyncReplicas: 1,
    partitions: [
      { partition: 0, earliestOffset: 277131, latestOffset: 306893, consumerOffset: 306893, sizeBytes: 6381568, isr: 3 },
      { partition: 1, earliestOffset: 276363, latestOffset: 306189, consumerOffset: 306189, sizeBytes: 6402048, isr: 3 },
      { partition: 2, earliestOffset: 276483, latestOffset: 306199, consumerOffset: 306199, sizeBytes: 6373376, isr: 3 },
    ],
  },
  {
    assetId: 'kafka.webshop.public.products',
    consumerGroup: 'ch-webshop-products-avro-v1',
    retentionHours: 168,
    replication: 3,
    minInsyncReplicas: 1,
    partitions: [
      { partition: 0, earliestOffset: 5541152, latestOffset: 6093087, consumerOffset: 6093087, sizeBytes: 102879232, isr: 3 },
      { partition: 1, earliestOffset: 5381000, latestOffset: 5997994, consumerOffset: 5997994, sizeBytes: 114909184, isr: 3 },
      { partition: 2, earliestOffset: 4396351, latestOffset: 4883725, consumerOffset: 4883722, sizeBytes: 92385280, isr: 3 },
    ],
  },
  {
    assetId: 'kafka.webshop.public.order_items',
    consumerGroup: 'ch-webshop-order_items-avro-v1',
    retentionHours: 168,
    replication: 3,
    minInsyncReplicas: 1,
    partitions: [
      { partition: 0, earliestOffset: 4838058, latestOffset: 5361222, consumerOffset: 5361219, sizeBytes: 53305344, isr: 3 },
      { partition: 1, earliestOffset: 4831681, latestOffset: 5354084, consumerOffset: 5354083, sizeBytes: 53280768, isr: 3 },
      { partition: 2, earliestOffset: 4833234, latestOffset: 5354469, consumerOffset: 5354466, sizeBytes: 53227520, isr: 3 },
    ],
  },
]

export const serviceFacts: ServiceFacts[] = [
  {
    serviceId: 'pg-37c7de3b',
    planPriceUsdPerHour: 0.151,
    nodeCount: 1,
    maintenanceDay: 'friday',
    maintenanceTime: '20:29:11',
    terminationProtection: false,
    openToInternet: true,
    techEmails: ['stan.dmitriev@aiven.io'],
    diskMb: 81920,
    maxConnections: 100,
    latestBackupAt: '2026-09-06T22:46:10Z',
    backupCount: 3,
    pendingUpdates: [],
  },
  {
    serviceId: 'kafka-1b5cb1e7',
    planPriceUsdPerHour: 0.397,
    nodeCount: 3,
    maintenanceDay: 'tuesday',
    maintenanceTime: '10:41:49',
    terminationProtection: false,
    openToInternet: true,
    techEmails: [],
    diskMb: 92160,
    pendingUpdates: [],
  },
  {
    serviceId: 'clickhouse-2a6274d2',
    planPriceUsdPerHour: 0.1885662,
    nodeCount: 1,
    maintenanceDay: 'thursday',
    maintenanceTime: '07:01:10',
    terminationProtection: false,
    openToInternet: true,
    techEmails: [],
    diskMb: 102400,
    latestBackupAt: '2026-09-06T12:46:16Z',
    backupCount: 3,
    pendingUpdates: [
      { description: 'Tiered storage zero copy improvements. Fixes a metadata leak in tiered storage.', startAt: '2026-09-17T07:01:10Z', deadline: '2026-09-22T10:41:50Z' },
      { description: 'Update ClickHouse 26.3 to version 26.3.26.3.', startAt: '2026-09-17T07:01:10Z', deadline: '2026-09-23T10:29:40Z' },
      { description: 'Restore improvements.', startAt: '2026-09-24T07:01:10Z', deadline: '2026-09-28T16:20:23Z' },
    ],
  },
  {
    serviceId: 'crm-pg',
    planPriceUsdPerHour: 0.034,
    nodeCount: 1,
    maintenanceDay: 'wednesday',
    maintenanceTime: '20:40:55',
    terminationProtection: false,
    openToInternet: true,
    techEmails: [],
    diskMb: 8192,
    maxConnections: 25,
    latestBackupAt: '2026-09-06T08:45:06Z',
    backupCount: 2,
    pendingUpdates: [],
  },
]
