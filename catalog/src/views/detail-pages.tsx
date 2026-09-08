import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LineageCanvas } from '@/components/lineage/lineage-canvas'
import { PageHeader } from '@/components/page-header'
import { ServiceIcon } from '@/lib/aiven-service-icons/ServiceIcon'
import { ICON_SIZES } from '@/lib/aiven-service-icons/icons.js'
import {
  assetsForService,
  blastRadius,
  formatCount,
  integrationsFor,
  isRuntime,
  serviceById,
  stackById,
  stackMembers,
  stacksForService,
  typeLabel,
} from '@/lib/catalog'
import { changesForService, fetchLiveChanges } from '@/lib/context-log'
import { eventsForService, factsForService } from '@/lib/operations'
import { buildDatasetGraph, buildServiceGraph } from '@/lib/lineage-graph'
import type { Navigate } from '@/lib/routes'
import { GitForkIcon } from 'lucide-react'
import type { ContextChange, Service, ServiceEvent } from '@/types'

function StateBadge({ state }: { state: Service['state'] }) {
  return <Badge variant={state === 'RUNNING' ? 'default' : 'outline'}>{state === 'RUNNING' ? 'Running' : 'Powered off'}</Badge>
}

function openResource(id: string, navigate: Navigate) {
  const service = serviceById(id)
  navigate(service && isRuntime(service) ? { page: 'application', id } : { page: 'service', id })
}

function OverviewFields({ service }: { service: Service }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {[
        ['Type', typeLabel(service.type)],
        ['Kind', isRuntime(service) ? 'Application runtime' : 'Service'],
        ['State', service.state],
        ['Plan', service.plan ?? '—'],
        ['Version', service.version ?? '—'],
        ['Cloud', service.cloud ?? 'aws-eu-west-1'],
      ].map(([label, value]) => (
        <Card key={label}>
          <CardHeader>
            <CardDescription>{label}</CardDescription>
            <CardTitle className="text-base">{value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

function AssetTable({ serviceId, navigate }: { serviceId: string; navigate: Navigate }) {
  const assets = assetsForService(serviceId)
  if (!assets.length) {
    return <p className="text-sm text-muted-foreground">No catalogued datasets on this resource.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Schema</TableHead>
          <TableHead>Columns</TableHead>
          <TableHead className="text-right">Rows</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.map((asset) => (
          <TableRow
            key={asset.id}
            className="cursor-pointer"
            onClick={() => navigate({ page: 'catalog', assetId: asset.id })}
          >
            <TableCell>
              <div className="font-medium">{asset.name}</div>
              <div className="text-xs text-muted-foreground">{asset.description}</div>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{asset.kind}</Badge>
            </TableCell>
            <TableCell>{asset.schema ?? '—'}</TableCell>
            <TableCell>{asset.columns.length}</TableCell>
            <TableCell className="text-right">{formatCount(asset.rowCount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function IntegrationTable({ serviceId, navigate }: { serviceId: string; navigate: Navigate }) {
  const items = integrationsFor(serviceId)
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">No integrations recorded.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>From</TableHead>
          <TableHead>To</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-medium">
              {item.type}
              {/* Flags the rows that describe a real data path Aiven has no integration object for. */}
              {item.origin ? (
                <Badge variant="outline" className="ml-1.5 font-normal">
                  {item.origin === 'connector' ? 'Connector' : 'App config'}
                </Badge>
              ) : null}
            </TableCell>
            <TableCell>
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => openResource(item.sourceServiceId, navigate)}>
                {item.sourceServiceId}
              </button>
            </TableCell>
            <TableCell>
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => openResource(item.destServiceId, navigate)}>
                {item.destServiceId}
              </button>
            </TableCell>
            <TableCell>
              <Badge variant={item.active ? 'default' : 'outline'}>{item.active ? 'Active' : 'Inactive'}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{item.description}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

const statusVariant = { ok: 'default', error: 'destructive', pending: 'outline' } as const

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function PurposeRow({ change }: { change: ContextChange }) {
  return (
    <div className="flex flex-col gap-1 border-l-2 pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Agent</Badge>
        <span className="font-mono text-sm font-medium">v{change.version}</span>
        <span className="text-sm">{change.operation}</span>
        <Badge variant={statusVariant[change.status]}>{change.status}</Badge>
        <span className="text-xs text-muted-foreground">
          {when(change.createdAt)} · {change.toolName}
          {change.durationMs == null ? '' : ` · ${change.durationMs}ms`} · {change.clientName}
        </span>
      </div>
      <p className="text-sm">{change.purpose || '(no purpose recorded)'}</p>
      {change.errorText ? <p className="text-xs text-destructive">{change.errorText}</p> : null}
    </div>
  )
}

const eventLabel: Record<string, string> = {
  service_create: 'created',
  service_delete: 'deleted',
  service_update: 'updated',
  service_master_promotion: 'master promotion',
  service_maintenance_perform: 'maintenance applied',
  service_integration_create: 'integration created',
  service_integration_delete: 'integration deleted',
}

function EventRow({ event }: { event: ServiceEvent }) {
  // Aiven names a person by email and itself by product name, which is the distinction that
  // matters here: a platform actor means the change happened without anyone asking for it.
  const automated = !event.actor.includes('@')
  return (
    <div className="flex flex-col gap-1 border-l-2 pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={automated ? 'default' : 'outline'}>{automated ? 'Platform' : 'Person'}</Badge>
        <span className="text-sm">
          {eventLabel[event.type] ?? event.type.replace('service_', '').replaceAll('_', ' ')}
        </span>
        <span className="text-xs text-muted-foreground">
          {when(event.at)} · {event.actor}
        </span>
      </div>
      <p className="line-clamp-3 text-sm text-muted-foreground">{event.description}</p>
    </div>
  )
}

function ChangeTimeline({ serviceId }: { serviceId: string }) {
  const snapshot = changesForService(serviceId)
  // Tagged with the service it was fetched for, so switching services falls back to that service's
  // snapshot during the render rather than needing the effect to clear stale rows first.
  const [live, setLive] = useState<{ serviceId: string; rows: ContextChange[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    // No error branch: the proxy being down is the normal case, and the snapshot already renders.
    fetchLiveChanges(serviceId).then(
      (rows) => {
        if (!cancelled) setLive({ serviceId, rows })
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [serviceId])

  const fresh = live?.serviceId === serviceId ? live.rows : null
  const changes = fresh ?? snapshot
  const events = eventsForService(serviceId)

  // Two sources answer two halves of "why is it like this": the proxy knows the purpose someone
  // wrote, Aiven knows what actually happened. Interleaved by time, they read as one history.
  const rows = [
    ...changes.map((change) => ({ at: change.createdAt, key: `purpose-${change.id}`, change })),
    ...events.map((event) => ({ at: event.at, key: event.id, event })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing recorded for this service, in either the local MCP proxy or Aiven's event log.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {/* The badge describes where the purpose rows came from, so it only appears when there are some. */}
        {changes.length ? <Badge variant="outline">{fresh ? 'Live proxy' : 'Snapshot'}</Badge> : null}
        <span>
          {[
            changes.length
              ? `${changes.length} agent ${changes.length === 1 ? 'change' : 'changes'} carrying a written purpose`
              : null,
            events.length ? `${events.length} ${events.length === 1 ? 'event' : 'events'} Aiven recorded itself` : null,
          ]
            .filter(Boolean)
            .join(', and ')}
          , newest first.
        </span>
      </div>
      {rows.map((row) =>
        'change' in row ? <PurposeRow key={row.key} change={row.change} /> : <EventRow key={row.key} event={row.event} />,
      )}
    </div>
  )
}

function SafetyPanel({ service }: { service: Service }) {
  const facts = factsForService(service.id)
  const radius = blastRadius(service.id)
  const dependents = [
    radius.downstreamAssets.length
      ? `feeds ${radius.downstreamAssets.length} downstream ${radius.downstreamAssets.length === 1 ? 'dataset' : 'datasets'} in ${radius.downstreamServices.join(', ')}`
      : null,
    radius.credentialHolders.length
      ? `hands credentials to ${radius.credentialHolders.join(', ')}`
      : null,
    radius.stacks.length ? `belongs to ${radius.stacks.join(' and ')}` : null,
  ].filter((line): line is string => line !== null)

  if (!facts && !dependents.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Before you change this</CardTitle>
        <CardDescription>
          {radius.datasets
            ? `Holds ${radius.datasets} catalogued ${radius.datasets === 1 ? 'dataset' : 'datasets'}, and ${dependents.join('; ')}.`
            : dependents.length
              ? `This resource ${dependents.join('; ')}.`
              : 'Nothing in the catalog depends on this resource.'}
        </CardDescription>
      </CardHeader>
      {facts ? (
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {/* The flags that change what you should do next, rather than every field Aiven returns.
                Red is reserved for danger you did not choose, like being reachable from anywhere;
                a single node is a cost/redundancy tradeoff to be aware of, so it reads as caution. */}
            <Badge variant={facts.nodeCount === 1 ? 'warning' : 'secondary'}>
              {facts.nodeCount === 1 ? 'Single node: a restart is downtime' : `${facts.nodeCount} nodes`}
            </Badge>
            {/* Milder still, so it stays out of both the warning and destructive palettes. */}
            <Badge variant={facts.terminationProtection ? 'secondary' : 'outline'}>
              {facts.terminationProtection ? 'Termination protected' : 'No termination protection'}
            </Badge>
            {facts.openToInternet ? <Badge variant="destructive">Reachable from 0.0.0.0/0</Badge> : null}
          </div>
          <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Maintenance', `${facts.maintenanceDay} ${facts.maintenanceTime.slice(0, 5)} UTC`],
              [
                'Cost',
                `$${facts.planPriceUsdPerHour.toFixed(3)}/h · ~$${Math.round(facts.planPriceUsdPerHour * 730)}/mo`,
              ],
              [
                'Last backup',
                facts.latestBackupAt ? `${when(facts.latestBackupAt)} · ${facts.backupCount} kept` : 'None taken',
              ],
              ['Contact', facts.techEmails.join(', ') || 'Nobody listed'],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
          {facts.pendingUpdates.length ? (
            <div className="flex flex-col gap-1.5 border-t pt-3">
              <span className="text-sm font-medium">
                {facts.pendingUpdates.length} pending platform {facts.pendingUpdates.length === 1 ? 'update' : 'updates'}
              </span>
              {facts.pendingUpdates.map((update) => (
                <p key={update.description} className="text-sm text-muted-foreground">
                  {update.description}{' '}
                  <span className="text-xs">
                    Starts {when(update.startAt)}, applied by {when(update.deadline)} whatever you do.
                  </span>
                </p>
              ))}
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  )
}

export function ServiceDetailPage({ id, navigate }: { id: string; navigate: Navigate }) {
  const [tab, setTab] = useState('overview')
  const service = serviceById(id)
  if (!service) return null
  const stacks = stacksForService(id)
  const focused = buildServiceGraph(undefined, { focusId: id })
  const listPage = isRuntime(service) ? 'applications' : 'services'
  const listLabel = isRuntime(service) ? 'Applications' : 'Services'

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'data-innovation-summit', onClick: () => navigate({ page: 'overview' }) },
          { label: listLabel, onClick: () => navigate({ page: listPage }) },
          { label: service.name },
        ]}
        actions={
          <Button variant="outline" onClick={() => navigate({ page: 'lineage' })}>
            <GitForkIcon data-icon="inline-start" />
            Open lineage
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6 [&>*]:shrink-0">
        <div className="flex items-center gap-3">
          <ServiceIcon type={service.type} label={typeLabel(service.type)} size={ICON_SIZES.detailHeader} />
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="type-large-heading">{service.name}</h1>
              <StateBadge state={service.state} />
              <Badge variant="secondary">{isRuntime(service) ? 'Runtime' : 'Service'}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{service.notes ?? service.role}</p>
          </div>
        </div>
        {stacks.length ? (
          <div className="flex flex-wrap gap-1.5">
            {stacks.map((stack) => (
              <Button key={stack.id} variant="outline" size="sm" onClick={() => navigate({ page: 'stack', id: stack.id })}>
                Stack: {stack.name}
              </Button>
            ))}
          </div>
        ) : null}

        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="datasets">{isRuntime(service) ? 'Connected data' : 'Databases'}</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="lineage">Lineage</TabsTrigger>
            <TabsTrigger value="changes">Changes</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-4">
            <div className="flex flex-col gap-4">
              <OverviewFields service={service} />
              <SafetyPanel service={service} />
            </div>
          </TabsContent>
          <TabsContent value="datasets" className="pt-4">
            <AssetTable serviceId={id} navigate={navigate} />
          </TabsContent>
          <TabsContent value="integrations" className="pt-4">
            <IntegrationTable serviceId={id} navigate={navigate} />
          </TabsContent>
          <TabsContent value="lineage" className="pt-4">
            {tab === 'lineage' ? (
              <div className="h-[480px]">
                <LineageCanvas
                  graphKey={`focus-${id}`}
                  nodes={focused.nodes}
                  edges={focused.edges}
                  onSelect={(node) => openResource(node.entityId, navigate)}
                />
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="changes" className="pt-4">
            {tab === 'changes' ? <ChangeTimeline serviceId={id} /> : null}
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

export function StackDetailPage({ id, navigate }: { id: string; navigate: Navigate }) {
  const [tab, setTab] = useState('members')
  const stack = stackById(id)
  if (!stack) return null
  const members = stackMembers(stack)
  const serviceGraph = buildServiceGraph(id)
  const datasetGraph = buildDatasetGraph(id)

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'data-innovation-summit', onClick: () => navigate({ page: 'overview' }) },
          { label: 'Stacks', onClick: () => navigate({ page: 'stacks' }) },
          { label: stack.name },
        ]}
        actions={
          <Button onClick={() => navigate({ page: 'lineage', stackId: id })}>
            <GitForkIcon data-icon="inline-start" />
            Open stack lineage
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6 [&>*]:shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{stack.name}</h1>
          <Badge variant="secondary">{stack.kind}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{stack.description}</p>

        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList variant="line">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="lineage">Service lineage</TabsTrigger>
            <TabsTrigger value="datasets">Dataset lineage</TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Runtimes and services</CardTitle>
                <CardDescription>Everything that makes up this product.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow
                        key={member.id}
                        className="cursor-pointer"
                        onClick={() => openResource(member.id, navigate)}
                      >
                        <TableCell className="font-medium">{member.name}</TableCell>
                        <TableCell>{isRuntime(member) ? 'Runtime' : 'Service'}</TableCell>
                        <TableCell>{typeLabel(member.type)}</TableCell>
                        <TableCell>
                          <StateBadge state={member.state} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="lineage" className="pt-4">
            {tab === 'lineage' ? (
              <div className="h-[520px]">
                <LineageCanvas
                  graphKey={`stack-svc-${id}`}
                  nodes={serviceGraph.nodes}
                  edges={serviceGraph.edges}
                  onSelect={(node) => openResource(node.entityId, navigate)}
                />
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="datasets" className="pt-4">
            {tab === 'datasets' ? (
              <div className="h-[520px]">
                <LineageCanvas
                  graphKey={`stack-ds-${id}`}
                  nodes={datasetGraph.nodes}
                  edges={datasetGraph.edges}
                  onSelect={(node) => navigate({ page: 'lineage', assetId: node.entityId, column: node.column, stackId: id })}
                />
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
