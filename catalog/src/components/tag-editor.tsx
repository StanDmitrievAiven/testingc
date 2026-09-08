import { useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { badgeVariants } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isPredefinedTag, normalizeTag, tagDescription, tagVocabulary } from '@/data/tags'
import { cn } from '@/lib/utils'

/**
 * The tags of one thing, from a service down to a single column. Each tag is one button: it carries
 * its own description on hover and removes itself on click, which avoids nesting a delete button
 * inside a hoverable badge and keeps the whole row reachable from the keyboard.
 *
 * Adding one opens the same searchable dialog the ⌘K palette uses. A menu was the wrong shape for
 * this: the vocabulary is long enough that the sensitivity tags sat twenty rows below the fold, and
 * a menu cannot hold a text field without fighting it for the keystrokes.
 */
export function TagEditor({
  tags,
  onChange,
  label,
}: {
  tags: string[]
  onChange: (next: string[]) => void
  /** Names what is being tagged, for the accessible label of the add button. */
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const applied = new Set(tags)

  const add = (tag: string) => {
    const clean = normalizeTag(tag)
    if (clean && !applied.has(clean)) onChange([...tags, clean])
    setOpen(false)
    setQuery('')
  }

  // The search box is the field for your own tag too: anything typed that is not already on offer
  // can be added as it stands, so there is no separate mode to switch into.
  const own = normalizeTag(query)
  const offerOwn = Boolean(own) && !isPredefinedTag(own) && !applied.has(own)

  const groups = tagVocabulary
    .map((group) => ({
      name: group.name,
      entries: Object.entries(group.tags).filter(([tag]) => !applied.has(tag)),
    }))
    .filter((group) => group.entries.length)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <Tooltip key={tag}>
          <TooltipTrigger
            aria-label={`Remove tag ${tag}`}
            className={cn(
              badgeVariants({ variant: isPredefinedTag(tag) ? 'secondary' : 'outline' }),
              'gap-1 pr-1 font-mono hover:bg-destructive/10 hover:text-destructive',
            )}
            onClick={() => onChange(tags.filter((item) => item !== tag))}
          >
            {tag}
            <XIcon className="size-3 opacity-60" />
          </TooltipTrigger>
          <TooltipContent>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{tag}</span>
              <span className="text-background/70">
                {tagDescription(tag) ?? 'Your own tag. It has no description.'}
              </span>
              <span className="text-background/50">Click to remove</span>
            </span>
          </TooltipContent>
        </Tooltip>
      ))}

      <Button
        variant="ghost"
        size="sm"
        className="gap-1"
        aria-label={`Add a tag to ${label}`}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4" />
        Tag
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={`Tag ${label}`}
        description="Search the tag vocabulary or write your own"
      >
        <Command>
          <CommandInput
            placeholder="Search tags…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>Nothing in the vocabulary matches.</CommandEmpty>
            {offerOwn ? (
              <CommandGroup heading="Your own tag">
                {/* Kept mounted through filtering: what you typed will rarely match itself once it
                    is a tag nobody has defined, and that is exactly when it has to stay offered. */}
                <CommandItem value={own} forceMount onSelect={() => add(own)}>
                  <span className="w-40 shrink-0 truncate font-mono text-xs">{own}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Added as it stands, without a description.
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groups.map((group) => (
              <CommandGroup key={group.name} heading={group.name}>
                {group.entries.map(([tag, description]) => (
                  // Searching the description too, so a tag can be found by what it means rather
                  // than only by a name you would have to know already.
                  <CommandItem
                    key={tag}
                    value={tag}
                    keywords={[description]}
                    onSelect={() => add(tag)}
                  >
                    <span className="w-40 shrink-0 truncate font-mono text-xs">{tag}</span>
                    <span className="truncate text-xs text-muted-foreground">{description}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  )
}
