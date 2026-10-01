// The service context document, rendered. Same module the emitted JSON comes from, so what a
// person reads here and what an agent fetches from /agent-context/<service>.json cannot drift.
//
// The ordering is the order the decision gets made: may I act at all, what is wrong, what is the
// play, what does it cost, who do I tell. Every number carries the tool it came from and when it
// was read, because that is what separates context from decoration.
import { BookOpenIcon, EyeOffIcon, UserIcon, UsersIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { serviceContext } from '@/lib/agent-context'
import { deviationById, deviationsFor } from '@/data/deviations'
import type { Finding, Objective, Runbook } from '@/types'

const severityBadge = { danger: 'destructive', caution: 'warning', info: 'secondary' } as const
const criticalityBadge = { critical: 'destructive', important: 'warning', standard: 'secondary', low: 'outline' } as const

/** `2026-09-08T10:55:00Z` reads as `8 Sep 10:55 UTC`, which is enough to judge freshness by. */
function when(iso: string): string {
  if (!iso.includes('T')) return iso
  const at = new Date(iso)
  return `${at.getUTCDate()} ${at.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')} UTC`
}

function RunbookDetails({ runbook }: { runbook: Runbook }) {
  return (
    // Native disclosure: it is keyboard accessible and searchable in-page without any state here.
    <details className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Runbook: {runbook.title}</summary>
      <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
        {runbook.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {[
          ['While it runs', runbook.whileItRuns],
          ['Takes', runbook.takes],
          ['Rollback', runbook.rollback],
          ['Verify it worked', runbook.verify],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {runbook.deviations?.length ? (
        // The upstream instinct, named before it is acted on. A step saying "set the ip filter"
        // means nothing to a reader whose next thought is pg_hba.conf.
        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-2">
          <span className="text-xs font-medium text-muted-foreground">Not the same as upstream</span>
          {runbook.deviations.map((id) => {
            const deviation = deviationById(id)
            return deviation ? (
              <span key={id} className="text-xs text-muted-foreground">
                {deviation.title}. {deviation.detail}
              </span>
            ) : null
          })}
        </div>
      ) : null}
      {runbook.docUrl ? <DocLink href={runbook.docUrl} /> : null}
    </details>
  )
}

/** Otso Virtanen's complaint, in one component: the documentation exists and nothing links to it. */
function DocLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline"
    >
      <BookOpenIcon className="size-3" />
      Aiven documentation
    </a>
  )
}

function FindingRow({
  finding,
  objective,
}: {
  finding: Finding & { runbook?: Runbook }
  objective?: Objective
}) {
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={severityBadge[finding.severity]}>{finding.severity}</Badge>
        <span className="font-medium">{finding.title}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{finding.detail}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        <code>{finding.source}</code>, read {when(finding.capturedAt)}
        {objective ? (
          // The threshold, and who to argue with about it. A finding that fires on a number nobody
          // declared is an alert from a stranger.
          <>
            {' · against '}
            <span title={objective.rationale}>
              {objective.title.toLowerCase()} ({objective.target} {objective.unit}), owned by {objective.owner},
              reviewed {objective.reviewed}
            </span>
          </>
        ) : null}
      </p>
      {finding.docUrl && !finding.runbook ? <DocLink href={finding.docUrl} /> : null}
      {finding.runbook ? <RunbookDetails runbook={finding.runbook} /> : null}
    </li>
  )
}

export function AgentContextPanel({ serviceId }: { serviceId: string }) {
  const doc = serviceContext(serviceId)
  if (!doc) return null

  const disk = doc.readings.find((r) => r.metric === 'disk_usage')

  const known = Object.values(doc.coverage).filter(Boolean).length

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {doc.classification ? (
              <>
                <Badge variant={criticalityBadge[doc.classification.criticality]}>
                  {doc.classification.criticality}
                </Badge>
                <Badge variant="outline">{doc.classification.environment}</Badge>
              </>
            ) : (
              <Badge variant="outline">unclassified</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {doc.classification
                ? // Inferred, and it says so: a classification passed off as declared is the one
                  // nobody corrects.
                  `${doc.classification.provenance} — ${doc.classification.evidence}`
                : 'Nobody has classified this service. Unclassified resolves to the most cautious setting rather than a convenient one.'}
            </span>
          </div>
          <CardTitle className="text-base">What an agent may do here</CardTitle>
          <CardDescription>{doc.policy.because}</CardDescription>
          <CardDescription className="text-xs">Policy {doc.policy.basis}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {doc.freeze.active ? (
            // The freeze outranks every finding below, so it is stated before them, not after.
            <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              Change freeze until {when(doc.freeze.to)}: {doc.freeze.reason}
            </p>
          ) : null}
          <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {[
              ['Unattended', doc.policy.allowed, 'secondary'],
              ['Needs a human', doc.policy.needsApproval, 'warning'],
              ['Never', doc.policy.forbidden, 'destructive'],
            ].map(([label, items, variant]) => (
              <div key={label as string}>
                <p className="text-xs font-medium text-muted-foreground">{label as string}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(items as string[]).length ? (
                    (items as string[]).map((item) => (
                      <Badge key={item} variant={variant as 'secondary' | 'warning' | 'destructive'}>
                        {item}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground">Nothing</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Policy, objectives and runbooks are authored, not measured. Everything else on this page names the Aiven
            tool it came from. Context known about this service: {known} of 5 —{' '}
            {Object.entries(doc.coverage)
              .filter(([, have]) => !have)
              .map(([name]) => name)
              .join(', ') || 'nothing missing'}
            {known < 5 ? ' missing.' : '.'}
          </p>
        </CardContent>
      </Card>

      {doc.capabilities ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What this plan can do</CardTitle>
            <CardDescription>
              The other half of "is it supposed to handle that?". Captured from the service, so what is not here was not
              measured rather than not true.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {[
              ['Nodes', `${doc.capabilities.nodes}`, doc.capabilities.failoverAvailable ? 'can fail over' : 'a restart is an outage'],
              ['Disk', `${doc.capabilities.diskGb} GB`, doc.capabilities.canAddDisk === undefined ? 'no priced rung matched' : doc.capabilities.canAddDisk ? 'can buy more without a plan change' : 'more space means a plan change'],
              ['Connections', doc.capabilities.maxConnections ? `${doc.capabilities.maxConnections}` : '—', doc.capabilities.maxConnections ? 'server maximum' : 'not captured for this type'],
              ['Backups held', `${doc.capabilities.backupsRetained ?? '—'}`, doc.capabilities.latestBackupAt ? `newest ${doc.capabilities.latestBackupAt.slice(0, 10)}` : 'none captured'],
              ['Read from', doc.capabilities.source, `at ${when(doc.captured.serviceFacts)}`],
            ].map(([label, value, note]) => (
              <div key={label}>
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className="font-medium">{value}</p>
                <p className="text-xs text-muted-foreground">{note}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {doc.findings.length
              ? `${doc.findings.length} ${doc.findings.length === 1 ? 'finding' : 'findings'}, worst first`
              : 'Nothing to act on'}
          </CardTitle>
          <CardDescription>
            {doc.findings.length
              ? 'Each one names its evidence and, where an action follows, the play for it.'
              : 'No finding fires on the captured evidence, which is itself the answer: leave it alone.'}
          </CardDescription>
        </CardHeader>
        {doc.findings.length ? (
          <CardContent>
            <ul className="flex flex-col">
              {doc.findings.map((finding) => (
                <FindingRow
                  key={`${finding.kind}-${finding.title}`}
                  finding={finding}
                  objective={doc.objectives.find((o) => o.id === finding.objective)}
                />
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Card>

      {doc.readings.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Headroom</CardTitle>
            <CardDescription>
              Percent, summarised over each metric's own window. A short or old window is stated rather than smoothed
              over, since it changes how much the number is worth.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              {doc.readings.map((reading) => (
                <div key={reading.metric}>
                  <p className="text-xs font-medium text-muted-foreground">{reading.metric.replace('_', ' ')}</p>
                  <p className="text-lg font-medium">{reading.latest.toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground">
                    {reading.min.toFixed(1)}–{reading.max.toFixed(1)}% over{' '}
                    {Math.round((Date.parse(reading.to) - Date.parse(reading.from)) / 86_400_000)} days
                    {reading.staleHours >= 1 ? `, ending ${Math.round(reading.staleHours)}h early` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">{reading.series}</p>
                </div>
              ))}
            </div>
            {disk?.trend ? (
              <p className="text-sm">
                {disk.trend.daysToFull === undefined
                  ? 'Disk is flat across the window, so there is no runway to estimate.'
                  : `Disk grows ${disk.trend.perDay.toFixed(2)} points a day, which is about ${Math.round(disk.trend.daysToFull)} days to full at this rate.`}
                {disk.trend.includesInitialLoad
                  ? ' The window opens when the service was created, so the initial load is inside that rate and the real runway is longer.'
                  : ''}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What a fix costs</CardTitle>
          <CardDescription>{doc.plan.note}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {doc.plan.options.map((option) => (
            <div key={option.plan} className="flex flex-wrap items-baseline gap-2">
              <Badge variant="outline">{option.plan}</Badge>
              <span>
                {option.diskGb} GB disk, ${option.usdPerHour.toFixed(3)} an hour: an extra $
                {option.extraUsdPerHour.toFixed(3)} an hour, about ${option.extraUsdPerMonth.toFixed(0)} a month.
              </span>
              {option.canAddDisk ? <Badge variant="secondary">can buy disk later</Badge> : null}
            </div>
          ))}
          {/* The other direction, which is the one nobody is shown. A saving that is refused still
              names its amount: the number is why somebody would try it anyway. */}
          <div className="flex flex-col gap-1 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Going the other way</span>
              <Badge variant={doc.plan.downsize.verdict === 'fits' ? 'default' : 'secondary'}>
                {doc.plan.downsize.verdict}
              </Badge>
              {doc.plan.downsize.monthlyUsdSaved ? (
                <span className="text-muted-foreground">saves ${doc.plan.downsize.monthlyUsdSaved} a month</span>
              ) : doc.plan.downsize.monthlyUsdForgone ? (
                <span className="text-muted-foreground">
                  ${doc.plan.downsize.monthlyUsdForgone} a month left on the table
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground">{doc.plan.downsize.because}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">State, and what is queued</CardTitle>
          <CardDescription>{doc.lifecycle.note}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <Badge variant={doc.lifecycle.state === 'RUNNING' ? 'default' : 'warning'}>{doc.lifecycle.state}</Badge>
            <span className="text-muted-foreground">
              {doc.lifecycle.stateReadAt ? `read ${when(doc.lifecycle.stateReadAt)}` : 'from the catalog, with no capture time'}
            </span>
          </div>
          <p className="text-muted-foreground">{doc.lifecycle.stateMeans}</p>
          {doc.lifecycle.maintenanceWindow ? (
            <p className="text-muted-foreground">
              Maintenance window: <span className="font-medium text-foreground">{doc.lifecycle.maintenanceWindow}</span>.
              Anything the platform has to do lands here unless it is applied sooner.
            </p>
          ) : null}
          {doc.lifecycle.updates.map((update) => (
            <div key={update.description} className="flex flex-col gap-1 border-t border-border pt-2">
              <span className="font-medium">{update.description}</span>
              <span className="text-muted-foreground">{update.impact}</span>
              <span className="text-xs text-muted-foreground">
                Takes {update.takes} · {update.deadlineNote}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Not the same as upstream</CardTitle>
          <CardDescription>
            Where this managed service differs from the project an agent has read the manual for. Authored, not
            captured — no API reports this — so each one carries the date it was last checked.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {/* The operator gets the internal ones too. The emitted document does not: these files
              leave the building, and a fact Aiven has not published should not leave with them. */}
          {deviationsFor(doc.type, true).map((deviation) => (
            <div key={deviation.id} className="flex flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{deviation.title}</span>
                <Badge variant="outline">{deviation.kind}</Badge>
                {deviation.internal ? (
                  <Badge variant="warning" className="gap-1">
                    <EyeOffIcon className="size-3" />
                    not shared with customers
                  </Badge>
                ) : null}
              </span>
              <span className="text-muted-foreground">{deviation.detail}</span>
              <span className="text-xs text-muted-foreground">
                Checked {deviation.reviewed}
                {deviation.docUrl ? (
                  <>
                    {' · '}
                    <a href={deviation.docUrl} target="_blank" rel="noreferrer" className="underline">
                      documentation
                    </a>
                  </>
                ) : null}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who to tell</CardTitle>
          <CardDescription>{doc.ownership}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Declared first and labelled as declared. The heading is doing real work: below it is a
              list of people who touched the service, and the two must not read as one list. */}
          {doc.owners.length ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">Owner, declared</p>
              <ul className="flex flex-col gap-1 text-sm">
                {doc.owners.map((owner) => (
                  <li key={owner.name} className="flex items-center gap-1.5">
                    {owner.kind === 'group' ? <UsersIcon className="size-3.5" /> : <UserIcon className="size-3.5" />}
                    <span className="font-medium">{owner.name}</span>
                    <span className="text-muted-foreground">— {owner.kind}, declared in this catalog</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {doc.contacts.length ? (
            <div className="flex flex-col gap-1">
              {doc.owners.length ? (
                <p className="text-xs font-medium text-muted-foreground">Contacts, observed</p>
              ) : null}
              <ul className="flex flex-col gap-1 text-sm">
                {doc.contacts.map((contact) => (
                  <li key={contact.email}>
                    <span className="font-medium">{contact.email}</span>
                    <span className="text-muted-foreground"> — {contact.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : doc.owners.length ? null : (
            <p className="text-sm text-muted-foreground">
              Nobody is listed as a contact and nobody appears in this service's event log, which is worth fixing before
              an incident rather than during one.
            </p>
          )}
          {doc.dependents.downstreamServices.length || doc.dependents.credentialHolders.length ? (
            <p className="text-sm text-muted-foreground">
              Acting here reaches{' '}
              {[
                doc.dependents.downstreamAssets.length
                  ? `${doc.dependents.downstreamAssets.length} downstream ${doc.dependents.downstreamAssets.length === 1 ? 'dataset' : 'datasets'} in ${doc.dependents.downstreamServices.join(', ')}`
                  : null,
                doc.dependents.credentialHolders.length
                  ? `${doc.dependents.credentialHolders.join(', ')} through service credentials`
                  : null,
              ]
                .filter(Boolean)
                .join(', and ')}
              .
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              render={<a href={`/agent-context/${doc.serviceId}.json`} target="_blank" rel="noreferrer" />}
            >
              Fetch this as JSON
            </Button>
            {/* The superset, kept off the page itself: it carries every column note under the
                service, which is what an agent wants and what a reader would have to scroll past. */}
            <Button
              variant="outline"
              size="sm"
              render={<a href={`/service-explain/${doc.serviceId}.json`} target="_blank" rel="noreferrer" />}
            >
              service_explain
            </Button>
            <span className="text-xs text-muted-foreground">
              This document at /agent-context/{doc.serviceId}.json, or the same thing plus every dataset, column and
              lineage hop at /service-explain/{doc.serviceId}.json
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
