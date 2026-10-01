// What each service is for, and what its failure costs.
//
// None of this is declared. Every service in the project carries an empty `tags: {}` in the Aiven
// API, so there is no customer-set environment anywhere to read. These are inferred, and each one
// names what the inference rests on — because the failure mode here is well known: a service
// called `dev` that is quietly production because somebody named it badly in a hurry.
//
// Two rules keep that from biting. A name is never sufficient on its own: `os-ddec4cf-dhtest` is
// classified as test because the name says so *and* nothing in the catalog depends on it *and* it
// has been powered off for a month. And anything absent from this list resolves to
// production-grade caution rather than to a default that happens to be convenient.
import type { Classification } from '../types.ts'

export const classifications: Classification[] = [
  {
    serviceId: 'pg-37c7de3b',
    environment: 'production',
    criticality: 'critical',
    provenance: 'inferred',
    evidence:
      'The webshop system of record, and the head of the change data capture chain: the connector reads its replication slot, so every downstream copy in Kafka, ClickHouse and Trino descends from this one database. Losing it loses data nothing else holds.',
  },
  {
    serviceId: 'kafka-1b5cb1e7',
    environment: 'production',
    criticality: 'critical',
    provenance: 'inferred',
    evidence:
      'The only path between the source database and every downstream copy, and the Schema Registry the consumers read. Nothing is lost if it stops, but everything stops with it, and retention turns a long enough stop into loss.',
  },
  {
    serviceId: 'crm-pg',
    environment: 'production',
    criticality: 'critical',
    provenance: 'inferred',
    evidence:
      'A system of record with nothing downstream of it, which is what makes it critical rather than merely important: there is no copy to rebuild from, so its backups are the only route back.',
  },
  {
    serviceId: 'kafkaconnect-30e121dd',
    environment: 'production',
    criticality: 'important',
    provenance: 'inferred',
    evidence:
      'The change data capture runtime. Its failure stops the flow rather than destroying anything, and it can be rebuilt from the replication slot, so it ranks below the database and the bus it sits between.',
  },
  {
    serviceId: 'clickhouse-2a6274d2',
    environment: 'production',
    criticality: 'important',
    provenance: 'inferred',
    evidence:
      'An analytics warehouse holding copies that arrived through Kafka. People depend on it and would notice within the hour, but every table in it can be rebuilt from upstream, so the cost of failure is time rather than data.',
  },
  {
    serviceId: 'marmot-pg',
    environment: 'production',
    criticality: 'standard',
    provenance: 'inferred',
    evidence:
      'The catalog store behind the Marmot application. It holds descriptions of data rather than data, and a failure degrades a tool rather than a pipeline.',
  },
  {
    serviceId: 'trino-hub-pg',
    environment: 'production',
    criticality: 'standard',
    provenance: 'inferred',
    evidence:
      'The Trino control plane: query history and configuration, not the data being queried. Federated queries fail while it is down and nothing underneath them is affected.',
  },
  {
    serviceId: 'os-ddec4cf-dhtest',
    environment: 'test',
    criticality: 'low',
    provenance: 'inferred',
    evidence:
      'Three independent signals agree, which is the bar a name alone never clears: the name ends in "dhtest", no asset or lineage edge in the catalog references it, and it has been powered off since 11 August with backups standing still since the same day.',
  },
]

export function classificationFor(serviceId: string): Classification | undefined {
  return classifications.find((c) => c.serviceId === serviceId)
}
