// Where the managed service is not the upstream project an agent has read the manual for.
//
// This is the cheapest content in the catalog and prevents the most common class of agent error:
// proposing a change that is perfectly valid Postgres and impossible here. A model that has read
// the Postgres documentation knows to edit `pg_hba.conf`; on Aiven there is no `pg_hba.conf` to
// edit, and the attempt fails after the change window has been booked and the runbook agreed.
//
// All authored, none captured — there is no API that returns "here is how we differ" — so every
// entry carries `reviewed` and the UI labels the block as authored. The documentation links were
// checked against the live site; `docs.check.ts` keeps them that way.
//
// `internal: true` marks facts Aiven does not publish to customers. They stay in the UI for the
// operator reading it and are stripped from everything emitted for an agent, because the emitted
// files are the ones that leave the building.
import type { Deviation } from '../types.ts'

export const deviations: Deviation[] = [
  {
    id: 'pg-no-hba',
    serviceTypes: ['pg'],
    kind: 'not configurable',
    title: 'There is no pg_hba.conf to edit',
    detail:
      'Host-based authentication is managed by the platform and not exposed. Network access is the service IP filter, and everything else is roles and grants inside the database. An agent reasoning from upstream Postgres will reach for the file first, and the file is not there.',
    docUrl: 'https://aiven.io/docs/platform/howto/restrict-access',
    reviewed: '2026-09-15',
  },
  {
    id: 'pg-no-superuser',
    serviceTypes: ['pg'],
    kind: 'differs from upstream',
    title: 'avnadmin is not a superuser',
    detail:
      'The administrative account has most privileges but not superuser, so anything requiring it fails: ALTER SYSTEM, untrusted procedural languages, and a handful of extensions. Server settings change through the service configuration API instead, which applies them the supported way and survives the next node rebuild.',
    docUrl: 'https://aiven.io/docs/tools/api',
    reviewed: '2026-09-15',
  },
  {
    id: 'pg-extensions',
    serviceTypes: ['pg'],
    kind: 'not configurable',
    title: 'Extensions come from a supported list, and some are not installed by CREATE EXTENSION',
    detail:
      'Only extensions Aiven packages are available, and several need enabling through service configuration rather than SQL. "It is on PGXN" is not a reason it can be installed here. Georg Traar named this as one of the deviations that is barely documented anywhere the customer can see.',
    docUrl: 'https://aiven.io/docs/products/postgresql/reference/list-of-extensions',
    reviewed: '2026-09-15',
  },
  {
    id: 'pg-connection-reserve',
    serviceTypes: ['pg'],
    kind: 'differs from upstream',
    title: 'Not all of max_connections is yours',
    detail:
      'The platform reserves connections for its own monitoring, backup and maintenance users, so a service reporting 100 gives the application slightly fewer. Connection pooling is a managed feature rather than something installed on the node.',
    docUrl: 'https://aiven.io/docs/products/postgresql/reference/pg-connection-limits',
    reviewed: '2026-09-15',
  },
  {
    id: 'auto-updates',
    serviceTypes: ['*'],
    kind: 'managed automatically',
    title: 'Minor versions and platform software update themselves',
    detail:
      'Security patches and minor version upgrades are applied in the maintenance window without being requested. A version changing between two readings of this catalog is expected behaviour rather than an incident, which is worth knowing before an agent opens one.',
    docUrl: 'https://aiven.io/docs/platform/concepts/maintenance-window',
    reviewed: '2026-09-15',
  },
  {
    id: 'platform-agents',
    serviceTypes: ['*'],
    kind: 'managed automatically',
    title: 'Aiven software runs on the nodes alongside yours',
    detail:
      'Monitoring, backup and orchestration processes run on every service, hold their own database connections, and appear in statistics as sessions and queries nobody in your team wrote. Customers are not generally aware of this, so the unexplained connection is usually ours.',
    docUrl: 'https://aiven.io/docs/platform/concepts/service-power-cycle',
    reviewed: '2026-09-15',
  },
  {
    id: 'rebuild-not-edit',
    serviceTypes: ['*'],
    kind: 'differs from upstream',
    title: 'Many changes replace the nodes rather than modify them',
    detail:
      'A plan change or a maintenance update generally builds new nodes and moves service to them, so node names change and anything pinned to a host or an IP breaks. This is why a plan change on a single-node service is downtime rather than a resize.',
    docUrl: 'https://aiven.io/docs/platform/howto/scale-services',
    reviewed: '2026-09-15',
  },
  {
    id: 'disk-without-plan',
    serviceTypes: ['*'],
    kind: 'differs from upstream',
    title: 'Disk can sometimes grow without a plan change',
    detail:
      'On plans that support it, storage is added to the running service, which makes "we are running out of disk" a smaller problem here than the upstream instinct of provisioning a bigger machine. Whether this service is one of them is in the plan block.',
    docUrl: 'https://aiven.io/docs/platform/concepts/dynamic-disk-sizing',
    reviewed: '2026-09-15',
  },
  {
    id: 'kafka-no-broker-access',
    serviceTypes: ['kafka'],
    kind: 'not configurable',
    title: 'No broker shell, and only a curated subset of broker settings',
    detail:
      'There is no host access and no coordination-layer access. Broker configuration is the subset Aiven exposes through service configuration; topic-level settings go through the API. Anything an upstream runbook does by editing server.properties or running a script on the broker has no equivalent.',
    docUrl: 'https://aiven.io/docs/products/kafka/howto/create-topic',
    reviewed: '2026-09-15',
  },
  {
    id: 'kafka-karapace',
    serviceTypes: ['kafka'],
    kind: 'differs from upstream',
    title: 'The schema registry is Karapace, not Confluent',
    detail:
      'API-compatible for the common paths, with its own authorisation model and its own endpoint on the service rather than a separate cluster. Client configuration copied from a Confluent tutorial usually points at the wrong place.',
    docUrl: 'https://aiven.io/docs/products/kafka/karapace/concepts/schema-registry-authorization',
    reviewed: '2026-09-15',
  },
  {
    id: 'backup-is-fork',
    serviceTypes: ['*'],
    kind: 'differs from upstream',
    title: 'Restoring means forking to a new service',
    detail:
      'Backups are not restored in place. The supported path creates a new service at a point in time, which you then move traffic to — so a restore is a migration with a connection-string change, not an afternoon of pg_restore. Worth knowing before promising a rollback that assumes otherwise.',
    docUrl: 'https://aiven.io/docs/platform/howto/console-fork-service',
    reviewed: '2026-09-15',
  },
  {
    id: 'disk-backing',
    serviceTypes: ['*'],
    kind: 'differs from upstream',
    title: 'Whether the disk is local or network-attached is not published',
    detail:
      'It varies by plan and cloud and changes the performance envelope, particularly for write-heavy workloads, and Aiven does not currently share it per plan. An engineer attributing latency to their own queries may be looking at the storage tier instead.',
    reviewed: '2026-09-15',
    internal: true,
  },
]

/** Authored for a service type, plus the ones that apply to everything. `*` last, as the general case. */
export function deviationsFor(serviceType?: string, includeInternal = false): Deviation[] {
  return deviations.filter(
    (deviation) =>
      (includeInternal || !deviation.internal) &&
      (deviation.serviceTypes.includes('*') || (serviceType !== undefined && deviation.serviceTypes.includes(serviceType))),
  )
}

export function deviationById(id: string): Deviation | undefined {
  return deviations.find((deviation) => deviation.id === id)
}
