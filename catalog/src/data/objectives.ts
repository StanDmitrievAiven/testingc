// The numbers a finding is allowed to fire on, declared rather than buried.
//
// Every one of these was, until now, a constant halfway down `lib/agent-context.ts` — ninety days
// of disk headroom, twenty-four hours before a reading goes stale, lag at half of retention. They
// worked, and nobody could see them, disagree with them, or say who owned them. That is the exact
// condition an operator described as the single biggest gap: thresholds that exist but are not
// declared, so an alert is an argument with a stranger.
//
// These are authored for this prototype. The owners below are the shape of the thing, not an
// agreed assignment — which is why every objective carries `reviewed`, and why the UI labels the
// whole block as authored rather than captured.
import type { Objective } from '../types.ts'

/** Most specific wins: a `pg` entry beats a `*` entry with the same id. See `objectiveFor`. */
export const objectives: Objective[] = [
  {
    id: 'disk-headroom',
    appliesTo: ['*'],
    title: 'At least a quarter of a year of disk runway',
    target: 90,
    unit: 'days to full',
    breach: 30,
    rationale:
      'Ninety days is long enough to plan a plan change into a maintenance window and get it approved. Thirty is short enough that the window is now, because on a single node growing the disk is an outage that has to be scheduled with whoever depends on it.',
    owner: 'Data platform team',
    reviewed: '2026-09-08',
  },
  {
    id: 'disk-headroom',
    appliesTo: ['kafka'],
    title: 'At least six weeks of disk runway on a broker',
    target: 45,
    unit: 'days to full',
    breach: 21,
    rationale:
      'Shorter than the fleet default on purpose. Broker disk moves with retention rather than with data growth, so a single retention change can consume weeks of runway in an afternoon, and the slow-moving trend is the wrong thing to plan against.',
    owner: 'Streaming team',
    reviewed: '2026-09-08',
  },
  {
    id: 'evidence-freshness',
    appliesTo: ['*'],
    title: 'Evidence no more than a day behind the snapshot it arrived in',
    target: 24,
    unit: 'hours behind capture',
    rationale:
      'A capacity claim is worth exactly as much as the reading under it. A day is the point where a trend computed from the numbers stops describing the service as it is now, and an agent acting on it is acting on history.',
    owner: 'Data platform team',
    reviewed: '2026-09-08',
  },
  {
    id: 'consumer-lag-headroom',
    appliesTo: ['kafka'],
    title: 'Consumers no more than halfway through what the topic still keeps',
    target: 50,
    unit: 'percent of retained records',
    breach: 80,
    rationale:
      'Retention is the deadline, not the lag itself. At half the retained window there is still a working day to fix the consumer; past eighty percent a single slow afternoon turns delayed records into lost ones, and no amount of catching up brings them back.',
    owner: 'Streaming team',
    reviewed: '2026-09-08',
  },
  {
    id: 'cpu-spike',
    appliesTo: ['*'],
    title: 'A peak worth naming',
    target: 50,
    unit: 'percent peak',
    rationale:
      'Below half a core-equivalent nothing is worth reporting. This decides only whether a spike gets mentioned, never whether anything is done about it.',
    owner: 'Data platform team',
    reviewed: '2026-09-08',
  },
  {
    id: 'cpu-sustained',
    appliesTo: ['*'],
    title: 'Sustained load, as opposed to bursts',
    target: 20,
    unit: 'percent average',
    rationale:
      'Under a fifth on average, a high peak is a query arriving rather than a service running out of room. The pair matters because resizing on a peak is the most common expensive mistake available here.',
    owner: 'Data platform team',
    reviewed: '2026-09-08',
  },
  {
    id: 'downsize-headroom',
    appliesTo: ['*'],
    title: 'A smaller plan must still leave a third of its disk free',
    target: 67,
    unit: 'percent of the smaller disk in use',
    rationale:
      'The saving is worth having and the second migration is not. Moving down to a rung that is already two-thirds full buys a few pounds a month and a disk-full incident a quarter later, which costs more than the plan ever saved. A third free is the margin that makes the move a decision rather than a bet on growth stopping.',
    owner: 'Data platform team',
    reviewed: '2026-09-15',
  },
  {
    id: 'downsize-utilisation',
    appliesTo: ['*'],
    title: 'Peaks well inside the plan before shrinking it',
    target: 60,
    unit: 'percent peak of any resource',
    rationale:
      'Averages are what make downsizing look free: a service at five percent mean CPU that touches sixty-five under load will meet that load on a smaller plan too, and meet it worse. The peak is the number the plan actually has to survive, so it is the one that decides.',
    owner: 'Data platform team',
    reviewed: '2026-09-15',
  },
  {
    id: 'backup-freshness',
    appliesTo: ['*'],
    title: 'A restore point from within the last two days',
    target: 48,
    unit: 'hours since the last backup',
    breach: 168,
    rationale:
      'Aiven takes daily backups, so two days allows one to fail without raising anything. A week means the restore point has quietly moved from yesterday to last Tuesday, which is only discovered at the worst possible moment.',
    owner: 'Data platform team',
    reviewed: '2026-09-15',
  },
]

/**
 * The objective in force for a service type. A type-specific entry beats the `*` default, so Kafka
 * gets its own disk runway without every other service inheriting it.
 */
export function objectiveFor(id: string, serviceType?: string): Objective | undefined {
  const matches = objectives.filter((o) => o.id === id)
  return matches.find((o) => serviceType !== undefined && o.appliesTo.includes(serviceType)) ?? matches.find((o) => o.appliesTo.includes('*'))
}
