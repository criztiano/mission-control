/**
 * Plan Parser — extracts interactive components from markdown HTML comments.
 *
 * Syntax:
 *   <!-- poll: "Question?" -->
 *   <!-- option: "Choice A" -->
 *   <!-- option: "Choice B" -->
 *   <!-- comment: true -->
 *
 *   <!-- checklist: "Title" -->
 *   <!-- check: "Item 1" -->
 *   <!-- check: "Item 2" -->
 *
 *   <!-- thumbs: "Question?" -->
 *   <!-- comment: true -->
 *
 *   <!-- approval: "Plan Title" -->
 *
 *   <!-- input: "Prompt text" -->
 */

export type PlanComponentType = 'poll' | 'checklist' | 'thumbs' | 'approval' | 'input'

export interface PlanPoll {
  kind: 'poll'
  id: string
  question: string
  options: string[]
  hasComment: boolean
}

export interface PlanChecklist {
  kind: 'checklist'
  id: string
  title: string
  items: string[]
}

export interface PlanThumbs {
  kind: 'thumbs'
  id: string
  question: string
  hasComment: boolean
}

export interface PlanApproval {
  kind: 'approval'
  id: string
  title: string
}

export interface PlanInput {
  kind: 'input'
  id: string
  prompt: string
}

export type PlanComponent = PlanPoll | PlanChecklist | PlanThumbs | PlanApproval | PlanInput

export interface PlanSegment {
  type: 'markdown' | 'component'
  content?: string       // for markdown segments
  component?: PlanComponent  // for component segments
}

// Simple hash for stable IDs
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

/**
 * Parse markdown into segments of regular markdown and interactive components.
 */
export function parsePlan(markdown: string): PlanSegment[] {
  if (!markdown) return [{ type: 'markdown', content: '' }]

  const segments: PlanSegment[] = []
  const lines = markdown.split('\n')
  let mdBuffer: string[] = []
  let i = 0

  function flushMd() {
    const text = mdBuffer.join('\n').trim()
    if (text) {
      segments.push({ type: 'markdown', content: text })
    }
    mdBuffer = []
  }

  function extractValue(line: string): string {
    const match = line.match(/<!--\s*\w+:\s*"([^"]*)"\s*-->/)
    return match ? match[1] : ''
  }

  function isDirective(line: string, directive: string): boolean {
    return new RegExp(`<!--\\s*${directive}:`).test(line.trim())
  }

  function isBoolDirective(line: string, directive: string): boolean {
    return new RegExp(`<!--\\s*${directive}:\\s*true\\s*-->`).test(line.trim())
  }

  while (i < lines.length) {
    const line = lines[i]

    // POLL
    if (isDirective(line, 'poll')) {
      flushMd()
      const question = extractValue(line)
      const options: string[] = []
      let hasComment = false
      i++
      while (i < lines.length) {
        if (isDirective(lines[i], 'option')) {
          options.push(extractValue(lines[i]))
          i++
        } else if (isBoolDirective(lines[i], 'comment')) {
          hasComment = true
          i++
        } else if (lines[i].trim() === '') {
          i++
        } else {
          break
        }
      }
      segments.push({
        type: 'component',
        component: {
          kind: 'poll',
          id: `poll-${simpleHash(question)}`,
          question,
          options,
          hasComment,
        },
      })
      continue
    }

    // CHECKLIST
    if (isDirective(line, 'checklist')) {
      flushMd()
      const title = extractValue(line)
      const items: string[] = []
      i++
      while (i < lines.length) {
        if (isDirective(lines[i], 'check')) {
          items.push(extractValue(lines[i]))
          i++
        } else if (lines[i].trim() === '') {
          i++
        } else {
          break
        }
      }
      segments.push({
        type: 'component',
        component: {
          kind: 'checklist',
          id: `checklist-${simpleHash(title)}`,
          title,
          items,
        },
      })
      continue
    }

    // THUMBS
    if (isDirective(line, 'thumbs')) {
      flushMd()
      const question = extractValue(line)
      let hasComment = false
      i++
      while (i < lines.length) {
        if (isBoolDirective(lines[i], 'comment')) {
          hasComment = true
          i++
        } else if (lines[i].trim() === '') {
          i++
        } else {
          break
        }
      }
      segments.push({
        type: 'component',
        component: {
          kind: 'thumbs',
          id: `thumbs-${simpleHash(question)}`,
          question,
          hasComment,
        },
      })
      continue
    }

    // APPROVAL
    if (isDirective(line, 'approval')) {
      flushMd()
      const title = extractValue(line)
      segments.push({
        type: 'component',
        component: {
          kind: 'approval',
          id: `approval-${simpleHash(title)}`,
          title,
        },
      })
      i++
      continue
    }

    // INPUT
    if (isDirective(line, 'input')) {
      flushMd()
      const prompt = extractValue(line)
      segments.push({
        type: 'component',
        component: {
          kind: 'input',
          id: `input-${simpleHash(prompt)}`,
          prompt,
        },
      })
      i++
      continue
    }

    // Regular markdown line
    mdBuffer.push(line)
    i++
  }

  flushMd()
  return segments
}

/**
 * Check if markdown contains any interactive plan components.
 */
export function hasInteractiveComponents(markdown: string): boolean {
  return /<!--\s*(poll|checklist|thumbs|approval|input):/.test(markdown)
}
