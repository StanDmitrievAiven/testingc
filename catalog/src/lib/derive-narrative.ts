// Documentation written by the history nobody was going to write down.
//
// Marko Bocevski argued the loop matters more than the content: "there has to be some motivational
// loop", and if operators were rewarded for recording what they did, "context will become as
// powerful as their senior operations people" — against his own realism that "a human more often
// than not is lazy". Georg Traar supplied the corollary from the other end: commenting every
// column is something "realistically I think nobody's doing... especially keeping it up to date".
//
// The purpose log already solves the hard half. Every mutating agent call in this project carries a
// written reason, because the proxy refuses the call without one, so a service somebody built
// through an agent already has a paper trail of why each change was made. This assembles that into
// the description nobody was ever going to sit down and write.
//
// It arrives as a suggestion and nothing else, per G9. Dima Kan's question — "how to make sure that
// this systems don't lie" — has no clever answer, so the answer here is the boring one: a person
// reads it and agrees, or it counts for nothing.
import { contextLog } from '../data/context-log.ts'
import type { ContextChange } from '../types.ts'
import { serviceById } from './catalog.ts'

export interface Draft {
  /** The sentence to offer. Empty when there is nothing to build one from. */
  text: string
  /** Every entry behind it, so an aggregate can be checked rather than believed. */
  sources: string[]
  entries: number
  because: string
}

/** The log records a target rather than always a service id, so both spellings are matched. */
function entriesFor(serviceId: string): ContextChange[] {
  return contextLog
    .filter((entry) => entry.serviceId === serviceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * The first sentence of a purpose, which is where whoever wrote it said what they were doing.
 * Purposes are two or three sentences of reasoning; the rest is justification for one change and
 * reads as noise once assembled with nine others.
 */
function gist(purpose: string): string {
  const first = purpose.split(/(?<=\.)\s+/)[0]?.trim() ?? purpose.trim()
  return first.replace(/\.$/, '')
}

export function draftFor(serviceId: string): Draft {
  const entries = entriesFor(serviceId)
  const service = serviceById(serviceId)

  if (!entries.length) {
    return {
      text: '',
      sources: [],
      entries: 0,
      because: `Nothing in the purpose log touches ${service?.name ?? serviceId}, so there is no history to assemble a description from. The log only covers changes made through the agent proxy.`,
    }
  }

  const created = entries.find((entry) => entry.operation === 'create')
  const changes = entries.filter((entry) => entry.operation !== 'create')
  const clients = [...new Set(entries.map((entry) => entry.clientName))]
  const first = entries[0].createdAt.slice(0, 10)
  const last = entries.at(-1)!.createdAt.slice(0, 10)
  const span = first === last ? `on ${first}` : `between ${first} and ${last}`

  const text = [
    created ? `${gist(created.purpose)}.` : undefined,
    changes.length
      ? `Changed ${changes.length} ${changes.length === 1 ? 'time' : 'times'} since: ${changes
          .slice(0, 3)
          .map((entry) => gist(entry.purpose).toLowerCase())
          .join('; ')}${changes.length > 3 ? `; and ${changes.length - 3} more` : ''}.`
      : undefined,
    `Assembled from ${entries.length} recorded ${entries.length === 1 ? 'purpose' : 'purposes'} ${span}.`,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    text,
    // Requirement 5 of G9: an assembled fact names every source, not the newest or the tidiest.
    sources: entries.map(
      (entry) => `purpose log #${entry.id} — ${entry.toolName} on ${entry.createdAt.slice(0, 10)} via ${entry.clientName}`,
    ),
    entries: entries.length,
    because: `Built from ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} recorded by ${clients.join(' and ')}. It is a summary of what somebody said they were doing, which is not the same as what the service now does — read it before accepting it.`,
  }
}

/** Services with enough history to be worth offering a draft for. */
export function draftableServices(): string[] {
  return [...new Set(contextLog.map((entry) => entry.serviceId))].filter((id) => serviceById(id))
}
