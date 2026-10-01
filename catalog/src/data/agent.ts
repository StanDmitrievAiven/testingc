// What an agent is allowed to do here, and what to do about each finding. Unlike operations.ts and
// catalog.ts, none of this is captured from Aiven: it is authored, and the UI and the emitted
// context both label it as such. An agent that cannot tell a measurement from a judgement will
// eventually quote one as the other.
//
// The shape is deliberately dull. A policy is three lists and a sentence; a runbook is steps plus
// the four things wiki runbooks leave out — what breaks while it runs, how long it takes, whether
// it can be undone, and the check that proves it worked.
import type { AgentPolicy, ChangeFreeze, Classification, Runbook } from '../types.ts'

/**
 * Nothing changes during the summit. This outranks every finding: an agent that has found a real
 * problem still waits, and says why it waited.
 */
export const changeFreeze: ChangeFreeze = {
  from: '2026-09-08T00:00:00Z',
  to: '2026-09-12T23:59:59Z',
  reason: 'Data Innovation Summit. The project is on stage, so nothing changes unattended, however good the reason.',
}

/**
 * Read is allowed everywhere in this project; the interesting column is what needs a human. Any
 * service without an entry is read-only — see `policyFor`, which fails closed rather than open.
 */
export const agentPolicies: AgentPolicy[] = [
  {
    serviceId: 'pg-37c7de3b',
    allowed: ['read metadata', 'read metrics', 'read query statistics'],
    needsApproval: ['restart', 'change plan', 'change ip filter', 'terminate a session'],
    forbidden: ['delete the service', 'drop the replication slot', 'disable backups'],
    because:
      'Single node holding the webshop source of truth, and the CDC connector reads its replication slot: dropping that slot loses changes that no downstream copy can reconstruct.',
  },
  {
    serviceId: 'kafka-1b5cb1e7',
    allowed: ['read metadata', 'read metrics', 'read topic configuration', 'read consumer lag'],
    needsApproval: ['raise retention', 'restart a broker', 'add partitions'],
    forbidden: ['delete a topic', 'lower retention', 'reduce replication factor'],
    because:
      'Three brokers make a rolling restart survivable, but lowering retention deletes records a lagging consumer has not read yet, and no amount of purpose makes that recoverable.',
  },
  {
    serviceId: 'clickhouse-2a6274d2',
    allowed: ['read metadata', 'read metrics'],
    needsApproval: ['apply pending maintenance', 'restart', 'change plan'],
    forbidden: ['delete the service', 'drop a table'],
    because:
      'Single node with three platform updates already queued against deadlines, so a restart here competes with maintenance Aiven will run anyway.',
  },
  {
    serviceId: 'crm-pg',
    allowed: ['read metadata', 'read metrics'],
    needsApproval: ['change plan', 'restart', 'add disk'],
    forbidden: ['delete the service', 'downgrade the plan'],
    because:
      'Single node whose disk is trending up. Growing the plan is reversible only while the data still fits the smaller one, so a downgrade is a door that closes behind you.',
  },
  {
    serviceId: 'kafkaconnect-30e121dd',
    allowed: ['read connector status', 'read metrics'],
    needsApproval: ['restart a connector', 'resume a connector', 'pause a connector'],
    forbidden: ['delete a connector', 'edit connector configuration'],
    because:
      'The only path from the webshop database to every downstream copy. A deleted connector loses its offsets, and the rebuild replays from whatever the slot still holds.',
  },
]

/** Read-only everywhere else, because an unlisted service is one nobody has thought about yet. */
export const defaultPolicy: Omit<AgentPolicy, 'serviceId'> = {
  allowed: ['read metadata'],
  needsApproval: [],
  forbidden: ['everything else'],
  because: 'No policy has been written for this service, so it is read-only until somebody writes one.',
}

/**
 * What criticality actually changes, which is the question the classification exists to answer.
 * Tagging a service `production` and then treating it identically is theatre; the difference has to
 * be designed and visible, so here it is as one table: the same operation moves between unattended,
 * approval and forbidden as the cost of being wrong rises.
 *
 * The five policies above override this where somebody has written something more specific about a
 * particular service. This table is what every other classified service gets.
 */
export const policyByCriticality: Record<Classification['criticality'], Omit<AgentPolicy, 'serviceId'>> = {
  critical: {
    allowed: ['read metadata', 'read metrics'],
    needsApproval: ['restart', 'change plan', 'change ip filter', 'apply pending maintenance'],
    forbidden: ['delete the service', 'disable backups', 'downgrade the plan'],
    because:
      'Critical means there is no second copy and no cheap way back, so every change that interrupts it waits for somebody who can weigh the interruption.',
  },
  important: {
    allowed: ['read metadata', 'read metrics'],
    needsApproval: ['restart', 'change plan', 'change ip filter', 'apply pending maintenance'],
    forbidden: ['delete the service', 'disable backups'],
    because:
      'Important means a failure costs time rather than data: the contents can be rebuilt from upstream, so the plan may move with approval, but nothing deletes it unattended.',
  },
  standard: {
    allowed: ['read metadata', 'read metrics', 'apply pending maintenance'],
    needsApproval: ['restart', 'change plan', 'change ip filter'],
    forbidden: ['delete the service'],
    because:
      'Standard means an outage degrades a tool rather than a pipeline. Maintenance can go in unattended, since the alternative is Aiven applying it at its own deadline anyway.',
  },
  low: {
    allowed: ['read metadata', 'read metrics', 'apply pending maintenance', 'restart', 'power off'],
    needsApproval: ['change plan', 'delete the service'],
    forbidden: [],
    because:
      'Low means nothing downstream notices. Restarting is cheaper than asking, but deletion still waits for a human, because a service classified low by inference is exactly the case where the inference might be wrong.',
  },
}

/**
 * One play per finding kind. Two of these answer findings nothing currently triggers — a dead
 * connector and a consumer about to pass retention — which is the point: the play has to exist
 * before the incident, not be written during it.
 */
export const runbooks: Runbook[] = [
  {
    forFinding: 'disk-filling',
    title: 'Give the service more disk before it fills',
    docUrl: 'https://aiven.io/docs/platform/concepts/dynamic-disk-sizing',
    deviations: ['disk-without-plan', 'rebuild-not-edit'],
    steps: [
      'Check the change freeze and the maintenance window before anything else.',
      'Confirm the trend on a fresh reading: aiven_service_metrics_fetch with period=week, metric disk_usage.',
      'Find the current plan with aiven_service_get, then look it up in the plan ladder.',
      'If the plan can buy disk on its own, add disk with aiven_service_update and stop there.',
      'If it cannot, the fix is the next plan up, also aiven_service_update, which restarts the service.',
      'Tell whoever depends on it before the restart, not after.',
    ],
    whileItRuns:
      'A plan change restarts the service. On a single node that is an outage, not a failover, and every open connection drops.',
    takes: 'Usually under ten minutes for a small plan, longer as the data grows.',
    rollback:
      'One way, in practice. You can only move back down while the data still fits the smaller plan, and the data is what grew.',
    verify:
      'Service state RUNNING, disk_usage below where it started on a fresh metrics read, and the application reconnects.',
  },
  {
    forFinding: 'open-to-internet',
    title: 'Close the service to the open internet',
    docUrl: 'https://aiven.io/docs/platform/howto/restrict-access',
    deviations: ['pg-no-hba'],
    steps: [
      'List what actually connects: the integrations in this catalog plus any application using a service credential.',
      'Collect the egress ranges those clients come from. A guess here locks out production.',
      'Replace the ip_filter with that list using aiven_service_update, leaving 0.0.0.0/0 out.',
      'Keep your own access in the list, or you lock yourself out along with everyone else.',
    ],
    whileItRuns:
      'Established connections survive. New connections from anything outside the list are refused immediately, which is the whole point and also the risk.',
    takes: 'Seconds to apply.',
    rollback: 'Reversible: put the previous filter back with the same call.',
    verify:
      'Connect from an allowed address, then from one that is not. The second attempt must fail, or the filter did not take.',
  },
  {
    forFinding: 'single-node',
    title: 'Restart a service that has no second node',
    docUrl: 'https://aiven.io/docs/products/postgresql/concepts/high-availability',
    deviations: ['rebuild-not-edit'],
    steps: [
      'Treat this as planned downtime and announce it, because that is what it is.',
      'Check no platform maintenance is already in flight for the same service.',
      'Prefer the existing maintenance window over a restart of your own.',
      'Restart, then watch the dependents rather than the service: it comes back before they do.',
    ],
    whileItRuns:
      'A total outage for the length of the restart. Change data capture stops and resumes from its replication slot; consumers downstream fall behind rather than lose data.',
    takes: 'A few minutes, most of it the service coming back up.',
    rollback: 'None. A restart cannot be undone, only waited out.',
    verify:
      'Service state RUNNING, the CDC connector back to RUNNING, and consumer lag falling across two readings rather than one.',
  },
  {
    forFinding: 'pending-maintenance',
    title: 'Apply platform maintenance before its deadline',
    docUrl: 'https://aiven.io/docs/platform/concepts/maintenance-window',
    deviations: ['auto-updates', 'rebuild-not-edit'],
    steps: [
      'Read the deadlines from aiven_service_get: after them, Aiven applies the update whether or not it suits you.',
      'Pick a window before the earliest deadline and inside the service maintenance window.',
      'Apply the updates there, oldest deadline first.',
    ],
    whileItRuns:
      'Rolling on a multi-node service, downtime on a single node. Either way it is the same interruption you would get by leaving it to the deadline, but at a time you chose.',
    takes: 'Minutes per update, longer for a version upgrade.',
    rollback: 'A version upgrade is one way. Plan for going forward, not back.',
    verify: 'The pending update list is empty and the service reports the new version.',
  },
  {
    forFinding: 'connector-down',
    title: 'Bring a stopped change data capture connector back',
    docUrl: 'https://aiven.io/docs/products/postgresql/concepts/aiven-db-migrate',
    steps: [
      'Read the trace with aiven_kafka_connect_get_connector_status before restarting anything.',
      'If the trace names authentication or a missing replication slot, fix that first: a restart will only fail again.',
      'Restart with aiven_kafka_connect_restart_connector.',
      'If the task fails a second time, pause it and escalate. Do not loop restarts.',
    ],
    whileItRuns:
      'Nothing further breaks: the flow has already stopped. Restarting resumes from the stored offset and loses nothing, unless the replication slot was dropped while it was down.',
    takes: 'Seconds to restart, then minutes to catch up on the backlog.',
    rollback: 'Pause the connector, which leaves the offsets where they are.',
    verify: 'State RUNNING with every task RUNNING, and lag falling across two readings.',
  },
  {
    forFinding: 'lag-against-retention',
    title: 'Stop a lagging consumer from losing records',
    docUrl: 'https://aiven.io/docs/products/kafka/howto/create-topic',
    deviations: ['kafka-no-broker-access'],
    steps: [
      'Compare how far behind the consumer is with how long the topic keeps records. That gap is the deadline.',
      'Raise retention first with aiven_kafka_topic_update. It is cheap, reversible, and buys time to fix the cause.',
      'Only then deal with the consumer itself.',
    ],
    whileItRuns: 'Nothing is interrupted. More retention simply uses more disk on the brokers.',
    takes: 'Seconds to apply, and it takes effect immediately.',
    rollback: 'Lower retention again once the consumer has caught up, not before.',
    verify:
      'Lag falling, and the oldest offset still behind the consumer position. If retention passes the consumer, records are already gone.',
  },
  {
    forFinding: 'stale-context',
    title: 'Refuse to act on a stale reading',
    steps: [
      'Do not act on a capacity finding whose evidence is older than the thing it claims to measure.',
      'Re-read with aiven_service_metrics_fetch and compare the window end against now.',
      'If the window is still short or still ends early, check the service is running at all before assuming the metric is wrong.',
    ],
    whileItRuns: 'Nothing. This play exists to stop an action, not to take one.',
    takes: 'One call.',
    rollback: 'Not applicable.',
    verify: 'The window ends within the last hour. Until it does, the finding stays unactionable.',
  },
  {
    forFinding: 'weak-password-encryption',
    title: 'Move Postgres password encryption from md5 to scram-sha-256',
    docUrl: 'https://aiven.io/docs/tools/api',
    deviations: ['pg-no-superuser', 'pg-no-hba'],
    steps: [
      'Set password_encryption to scram-sha-256 with aiven_service_update. Existing md5 hashes keep working; the setting only decides how the next password is stored.',
      'List the roles still holding an md5 hash: select usename, passwd like \'SCRAM-SHA-256%\' as scram from pg_shadow.',
      'Reset each password, which is what actually converts the hash. A role nobody resets stays on md5 indefinitely.',
      'Update every client that holds the password in the same window, including service integrations.',
    ],
    whileItRuns:
      'Changing the setting alone interrupts nothing. Resetting a password does: every client still using the old one fails to authenticate until it is updated, and a forgotten integration is how that becomes an outage.',
    takes: 'Seconds for the setting. The password resets take as long as finding every client that holds one.',
    rollback: 'Reversible: set the parameter back and reset the passwords again, which has the same client impact in reverse.',
    verify: 'pg_shadow shows every role on a SCRAM-SHA-256 hash, and each client reconnects.',
  },
  {
    forFinding: 'powered-off',
    title: 'Decide what a stopped service is for',
    steps: [
      'Check what depends on it before anything else. In this catalog that is the blast radius on the service page; if it is empty, nothing here reads it.',
      'Ask whoever created it whether it is finished with. A stopped service is ambiguous by nature: it is either abandoned or deliberately parked.',
      'If it is finished with, delete it — and take the backups with it deliberately rather than by accident.',
      'If it is parked, tighten the ip filter now rather than at the moment it powers back on.',
    ],
    whileItRuns: 'Nothing, while it stays off. Powering it back on restores a service whose software is a month behind.',
    takes: 'Minutes to decide, seconds to act.',
    rollback:
      'Deletion is the one-way door here. Backups outlive the service for a limited window, and that window is not a plan.',
    verify: 'Either the service is gone from the project, or it is running again with an ip filter that is not 0.0.0.0/0.',
  },
  {
    forFinding: 'backup-stale',
    title: 'Find out why backups stopped',
    steps: [
      'Read the backup list from aiven_service_get and find where the gap starts.',
      'Check the service was actually running across the gap. A stopped service has nothing to back up, and that is the common answer.',
      'If it was running, check disk: a full disk stops backups before it stops anything else a person notices.',
      'If neither explains it, raise it with Aiven rather than waiting for the next one to succeed.',
    ],
    whileItRuns: 'Nothing. Investigating a backup gap changes nothing about the service.',
    takes: 'Minutes.',
    rollback: 'Not applicable: nothing is being changed.',
    verify: 'A backup exists with a timestamp inside the objective window, on a fresh read rather than the snapshot.',
  },
  {
    forFinding: 'no-termination-protection',
    title: 'Turn on termination protection',
    steps: ['Set termination protection with aiven_service_update.'],
    whileItRuns: 'Nothing. It is a configuration flag, with no restart.',
    takes: 'Seconds.',
    rollback: 'Reversible with the same call, which is exactly why it is worth having on.',
    verify: 'Read the service back and confirm the flag is set.',
  },
]
