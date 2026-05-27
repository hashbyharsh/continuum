/**
 * Prompt Recommendations — Template Library
 *
 * A curated set of efficient prompt templates organized by task category.
 * Each template is designed to minimize token usage while maximizing clarity.
 */
import type { TaskCategory } from '../types.js'

export type PromptTemplate = {
  name: string
  category: TaskCategory
  description: string
  /** What inefficiency this template addresses */
  fixes: string[]
  /** Estimated token count of this template (filled-in) */
  estimatedTokens: number
  template: string
  /** Example filled-in version */
  example?: string
}

export const TEMPLATES: PromptTemplate[] = [
  // ── Debugging ──────────────────────────────────────────────────────────────
  {
    name: 'concise-bug-report',
    category: 'debugging',
    description: 'Minimal bug report that includes only essential context',
    fixes: ['too_verbose', 'vague_task'],
    estimatedTokens: 80,
    template: `Bug in [FILE:LINE]: [ONE-LINE DESCRIPTION]
Error: [ERROR MESSAGE]
Expected: [EXPECTED BEHAVIOR]
Actual: [ACTUAL BEHAVIOR]
Fix it.`,
    example: `Bug in auth.ts:42: JWT token not refreshing on expiry
Error: TokenExpiredError: jwt expired
Expected: Auto-refresh when <5 min remaining
Actual: Hard fails after expiry
Fix it.`,
  },
  {
    name: 'targeted-debug',
    category: 'debugging',
    description: 'Pinpoint a specific function without pasting entire file',
    fixes: ['too_verbose', 'repeated_context'],
    estimatedTokens: 60,
    template: `In [FUNCTION NAME] ([FILE]), why does [BEHAVIOR]? Return only the fixed code block.`,
  },

  // ── Coding ─────────────────────────────────────────────────────────────────
  {
    name: 'implement-with-constraints',
    category: 'coding',
    description: 'Request implementation with explicit output constraints',
    fixes: ['no_format_constraint', 'vague_task'],
    estimatedTokens: 70,
    template: `Implement [FUNCTION/CLASS NAME]:
- Input: [PARAMS + TYPES]
- Output: [RETURN TYPE + SHAPE]
- Constraints: [EDGE CASES / LIMITS]
Return only the function, no explanation.`,
  },
  {
    name: 'diff-only-edit',
    category: 'coding',
    description: 'Request code changes as a diff to avoid reprinting whole files',
    fixes: ['too_verbose', 'repeated_context'],
    estimatedTokens: 40,
    template: `In [FILE], [CHANGE DESCRIPTION]. Show only the changed lines (unified diff format).`,
  },

  // ── Refactoring ────────────────────────────────────────────────────────────
  {
    name: 'scoped-refactor',
    category: 'refactoring',
    description: 'Refactor a specific unit without re-reading the whole file',
    fixes: ['too_verbose', 'missing_cache_hint'],
    estimatedTokens: 50,
    template: `Refactor [FUNCTION/CLASS] in [FILE]:
Goal: [ONE-LINE GOAL]
Keep: [WHAT TO PRESERVE]
Return: the refactored block only.`,
  },

  // ── Testing ────────────────────────────────────────────────────────────────
  {
    name: 'targeted-test',
    category: 'testing',
    description: 'Generate tests for a specific function, not an entire module',
    fixes: ['vague_task', 'no_format_constraint'],
    estimatedTokens: 65,
    template: `Write [N] unit tests for [FUNCTION NAME] covering:
1. [HAPPY PATH]
2. [EDGE CASE]
3. [ERROR CASE]
Use [TEST FRAMEWORK]. No imports needed, I'll add them.`,
  },

  // ── Feature ────────────────────────────────────────────────────────────────
  {
    name: 'feature-spec',
    category: 'feature',
    description: 'Structured feature request that avoids ambiguous back-and-forth',
    fixes: ['vague_task', 'too_verbose'],
    estimatedTokens: 90,
    template: `Add [FEATURE NAME] to [FILE/MODULE]:
What: [ONE-LINE DESCRIPTION]
Where: [ENTRY POINT / HOOK POINT]
Interface: [FUNCTION SIGNATURE OR UI ELEMENT]
Don't change anything else.`,
  },

  // ── Exploration ────────────────────────────────────────────────────────────
  {
    name: 'focused-explain',
    category: 'exploration',
    description: 'Ask for a focused explanation with a length cap',
    fixes: ['no_format_constraint', 'too_verbose'],
    estimatedTokens: 30,
    template: `Explain [CONCEPT/CODE] in ≤3 sentences. No background, just the answer.`,
  },
  {
    name: 'bullet-summary',
    category: 'exploration',
    description: 'Request a scannable bullet-point summary instead of prose',
    fixes: ['no_format_constraint'],
    estimatedTokens: 25,
    template: `Summarize [TOPIC/FILE] as ≤5 bullet points. Each point ≤15 words.`,
  },

  // ── Planning ───────────────────────────────────────────────────────────────
  {
    name: 'structured-plan',
    category: 'planning',
    description: 'Ask for a concise numbered plan rather than open-ended discussion',
    fixes: ['no_format_constraint', 'vague_task'],
    estimatedTokens: 45,
    template: `Plan [TASK] in ≤6 numbered steps. Each step: action verb + target. No prose.`,
  },

  // ── Git ────────────────────────────────────────────────────────────────────
  {
    name: 'commit-message',
    category: 'git',
    description: 'Generate a conventional commit message without context noise',
    fixes: ['too_verbose'],
    estimatedTokens: 20,
    template: `Write a conventional commit message for: [CHANGE SUMMARY]. Format: type(scope): description`,
  },

  // ── Conversation ───────────────────────────────────────────────────────────
  {
    name: 'yes-no-first',
    category: 'conversation',
    description: 'Get a direct yes/no then explanation — cuts preamble tokens',
    fixes: ['no_format_constraint'],
    estimatedTokens: 20,
    template: `[QUESTION]? Answer yes/no first, then explain in ≤2 sentences if needed.`,
  },
]

export function getTemplatesForCategory(category: TaskCategory): PromptTemplate[] {
  return TEMPLATES.filter(t => t.category === category)
}

export function getTemplateByName(name: string): PromptTemplate | undefined {
  return TEMPLATES.find(t => t.name === name)
}

export function getAllCategories(): TaskCategory[] {
  return [...new Set(TEMPLATES.map(t => t.category))]
}
