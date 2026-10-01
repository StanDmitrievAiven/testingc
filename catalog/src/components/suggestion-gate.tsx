// The review gate. Generated context arrives here as a proposal and leaves as fact only if
// somebody says so.
//
// Two things are deliberately awkward. Generation is refused until the scope has been granted, and
// the grant records who gave it — a checkbox ticked once for everything is opt-out wearing a
// costume. And a suggestion is rendered unmistakably as a suggestion: dashed, badged, and never
// counted as the description until accepted, because the failure Marko Bocevski described is not
// somebody accepting a bad sentence, it is nobody looking at all.
import { CheckIcon, SparklesIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCatalogEdits } from '@/lib/catalog-edits'
import { draftFor } from '@/lib/derive-narrative'

/**
 * Sits under the description of a service. The scope is the grant's unit: granting `crm-pg` does
 * not grant the rest of the project.
 */
export function SuggestionGate({ serviceId }: { serviceId: string }) {
  const edits = useCatalogEdits()
  const provenance = edits.provenanceOf(serviceId)
  const draft = draftFor(serviceId)
  const grant = edits.grantsHeld()[serviceId] ?? edits.grantsHeld()['*']

  // Nothing to offer and nothing outstanding: no control, rather than a button that explains itself
  // after being pressed.
  if (!draft.entries && provenance?.state !== 'suggested') return null

  if (provenance?.state === 'suggested') {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-warning bg-warning/5 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning" className="gap-1">
            <SparklesIcon className="size-3" />
            suggested, not accepted
          </Badge>
          <Tooltip>
            <TooltipTrigger className="text-xs text-muted-foreground underline decoration-dotted">
              {provenance.sources?.length ?? 0} sources
            </TooltipTrigger>
            <TooltipContent className="max-w-96">
              <span className="flex flex-col gap-0.5">
                {provenance.sources?.map((source) => (
                  <span key={source}>{source}</span>
                ))}
              </span>
            </TooltipContent>
          </Tooltip>
          <span className="text-xs text-muted-foreground">
            by {provenance.author}, {provenance.at.slice(0, 10)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{draft.because}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => edits.review(serviceId, 'accepted')}>
            <CheckIcon className="size-4" />
            Accept as the description
          </Button>
          <Button size="sm" variant="outline" onClick={() => edits.review(serviceId, 'rejected')}>
            <XIcon className="size-4" />
            Reject and remove it
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="gap-1"
        onClick={() => {
          if (!grant) edits.grantGeneration(serviceId, 'you')
          edits.suggest(serviceId, draft.text, { author: 'derived from the purpose log', sources: draft.sources })
        }}
      >
        <SparklesIcon className="size-4" />
        {grant ? 'Draft from the purpose log' : 'Allow drafting, then draft'}
      </Button>
      <span className="text-xs text-muted-foreground">
        {grant
          ? `Drafting allowed here by ${grant.by} on ${grant.at.slice(0, 10)}. ${draft.entries} recorded ${draft.entries === 1 ? 'purpose' : 'purposes'} to build from.`
          : `${draft.entries} recorded ${draft.entries === 1 ? 'purpose' : 'purposes'} sit behind this service. Nothing is generated until you allow it, and the permission is recorded against you.`}
      </span>
      {provenance?.state === 'accepted' && provenance.author !== 'you' ? (
        <Badge variant="secondary">accepted, was {provenance.author}</Badge>
      ) : null}
    </div>
  )
}
