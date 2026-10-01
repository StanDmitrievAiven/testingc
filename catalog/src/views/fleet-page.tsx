// Where to look first, across the whole project.
//
// Every other page in this catalog answers a question about one thing. This one answers the
// question an operator actually opens a console with — which of these thirty-three needs me today —
// and the honest second half of that answer: how many of them we know anything about at all.
import { AlertTriangleIcon, CircleSlashIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { catalog } from '@/data/catalog'
import { ServiceIcon } from '@/lib/aiven-service-icons/ServiceIcon'
import { isRuntime, serviceById, typeLabel } from '@/lib/catalog'
import { fleetCoverage, fleetFindings, fleetRows } from '@/lib/fleet'
import type { Navigate } from '@/lib/routes'

const severityBadge = { danger: 'destructive', caution: 'warning', info: 'secondary' } as const
const criticalityBadge = {
  critical: 'destructive',
  important: 'warning',
  standard: 'secondary',
  low: 'outline',
} as const

export function FleetPage({ navigate }: { navigate: Navigate }) {
  const rows = fleetRows()
  const findings = fleetFindings()
  const coverage = fleetCoverage()
  const needAttention = rows.filter((row) => row.findings > 0)

  const open = (serviceId: string) => {
    const service = serviceById(serviceId)
    if (!service) return
    navigate(
      isRuntime(service)
        ? { page: 'application', id: serviceId }
        : { page: 'service', id: serviceId, tab: 'agent' },
    )
  }

  return (
    <>
      <PageHeader crumbs={[{ label: catalog.project }, { label: 'Fleet' }]} />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6 [&>*]:shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">Fleet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {catalog.services.length} services, ranked by their worst finding and then by criticality. Findings below
            the table are the ones no single service page can show, because they are patterns across several.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {needAttention.length} {needAttention.length === 1 ? 'service has' : 'services have'} something to look at
            </h2>
            <p className="text-sm text-muted-foreground">
              Worst first. Criticality breaks the tie, because seven of these are open to the internet and a board where
              everything is red is a board nobody has sorted.
            </p>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Classification</TableHead>
                    <TableHead>Worst finding</TableHead>
                    <TableHead className="text-right">Findings</TableHead>
                    <TableHead className="text-right">Context</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.serviceId}
                      className="cursor-pointer"
                      onClick={() => open(row.serviceId)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          open(row.serviceId)
                        }
                      }}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ServiceIcon type={row.type} label={typeLabel(row.type)} size={16} />
                          <span className="font-medium">{row.name}</span>
                          {row.state !== 'RUNNING' ? <Badge variant="outline">{row.state}</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.criticality ? (
                          <div className="flex items-center gap-1.5">
                            <Badge variant={criticalityBadge[row.criticality]}>{row.criticality}</Badge>
                            <span className="text-xs text-muted-foreground">{row.environment}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">unclassified, so read-only</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[28rem]">
                        {row.worst ? (
                          <div className="flex items-center gap-2">
                            <Badge variant={severityBadge[row.worst.severity]}>{row.worst.severity}</Badge>
                            <span className="truncate text-sm">{row.worst.title}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {row.coverage.facts ? 'Nothing found' : 'No evidence captured'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.findings || '—'}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className="text-xs tabular-nums text-muted-foreground"
                          title="Operational facts, metrics, classification, a policy, and somebody to tell."
                        >
                          {row.known}/5
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold">Across the fleet</h2>
            <p className="text-sm text-muted-foreground">
              Findings that only exist in aggregate. A setting one person applied once is invisible on its own page and
              obvious in a list of seven.
            </p>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {findings.map((finding) => (
              <Card key={finding.kind}>
                <CardHeader>
                  <div className="flex items-start gap-2">
                    {finding.severity === 'info' ? (
                      <CircleSlashIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <AlertTriangleIcon
                        className={`mt-0.5 size-4 shrink-0 ${finding.severity === 'danger' ? 'text-destructive' : 'text-warning'}`}
                      />
                    )}
                    <div className="flex flex-col gap-1">
                      <CardTitle className="text-base">{finding.title}</CardTitle>
                      <CardDescription>{finding.detail}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {finding.serviceIds.slice(0, 8).map((id) => (
                      <button key={id} type="button" onClick={() => open(id)}>
                        <Badge variant="outline">{serviceById(id)?.name ?? id}</Badge>
                      </button>
                    ))}
                    {finding.serviceIds.length > 8 ? (
                      <Badge variant="secondary">and {finding.serviceIds.length - 8} more</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <code>{finding.source}</code>, read {finding.capturedAt.replace('T', ' ').slice(0, 16)} UTC
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">How much of this project we actually know</CardTitle>
            <CardDescription>
              An unset field counts as missing rather than as a default, so these numbers are pessimistic on purpose.
              Thin context is a reason for an agent to decline, and that only works if the thinness is visible.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {coverage.dimensions.map((dimension) => (
              <div key={dimension.name} className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">{dimension.name}</p>
                <p className="text-lg font-medium tabular-nums">
                  {dimension.have}
                  <span className="text-sm text-muted-foreground">/{dimension.of}</span>
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(dimension.have / dimension.of) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{dimension.note}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
