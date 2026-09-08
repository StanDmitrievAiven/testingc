// The service context document, rendered. Same module the emitted JSON comes from, so what a
// person reads here and what an agent fetches from /agent-context/<service>.json cannot drift.
//
// The ordering is the order the decision gets made: may I act at all, what is wrong, what is the
// play, what does it cost, who do I tell. Every number carries the tool it came from and when it
// was read, because that is what separates context from decoration.
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { serviceContext } from '@/lib/agent-context'
import type { Finding, Runbook } from '@/types'

const severityBadge = { danger: 'destructive', caution: 'warning', info: 'secondary' } as const

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
    </details>
  )
}

function FindingRow({ finding }: { finding: Finding & { runbook?: Runbook } }) {
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={severityBadge[finding.severity]}>{finding.severity}</Badge>
        <span className="font-medium">{finding.title}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{finding.detail}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        <code>{finding.source}</code>, read {when(finding.capturedAt)}
      </p>
      {finding.runbook ? <RunbookDetails runbook={finding.runbook} /> : null}
    </li>
  )
}

export function AgentContextPanel({ serviceId }: { serviceId: string }) {
  const doc = serviceContext(serviceId)
  if (!doc) return null

  const disk = doc.readings.find((r) => r.metric === 'disk_usage')

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What an agent may do here</CardTitle>
          <CardDescription>{doc.policy.because}</CardDescription>
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
            Policy and runbooks are authored, not measured. Everything else on this page names the Aiven tool it came
            from.
          </p>
        </CardContent>
      </Card>

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
                <FindingRow key={`${finding.kind}-${finding.title}`} finding={finding} />
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
        {doc.plan.options.length ? (
          <CardContent className="flex flex-col gap-2 text-sm">
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
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who to tell</CardTitle>
          <CardDescription>{doc.ownership}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {doc.contacts.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {doc.contacts.map((contact) => (
                <li key={contact.email}>
                  <span className="font-medium">{contact.email}</span>
                  <span className="text-muted-foreground"> — {contact.why}</span>
                </li>
              ))}
            </ul>
          ) : (
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
            <span className="text-xs text-muted-foreground">
              The same document an agent reads, at /agent-context/{doc.serviceId}.json
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
