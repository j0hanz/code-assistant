import { z } from 'zod';

import { createBoundedString, createBoundedStringArray } from './helpers.js';

const OUTPUT_LIMITS = {
  reviewDiffResult: {
    summary: { min: 1, max: 2_000 },
    findingsMax: 50,
    testsNeeded: { minItems: 0, maxItems: 20, itemMin: 1, itemMax: 300 },
  },
  complexity: {
    timeComplexity: { min: 1, max: 200 },
    spaceComplexity: { min: 1, max: 200 },
    explanation: { min: 1, max: 2_000 },
    bottleneck: { min: 1, max: 500, maxItems: 10 },
  },
  apiBreaking: {
    element: { min: 1, max: 300 },
    natureOfChange: { min: 1, max: 500 },
    consumerImpact: { min: 1, max: 500 },
    suggestedMitigation: { min: 1, max: 500 },
    maxItems: 20,
  },
} as const;

const QUALITY_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const MERGE_RISK_LEVELS = ['low', 'medium', 'high'] as const;
const REVIEW_SUMMARY_LIMITS = OUTPUT_LIMITS.reviewDiffResult.summary;
const ERROR_KINDS = [
  'validation',
  'budget',
  'upstream',
  'timeout',
  'cancelled',
  'busy',
  'internal',
] as const;

function createReviewSummarySchema(description: string): z.ZodString {
  return z
    .string()
    .min(REVIEW_SUMMARY_LIMITS.min)
    .max(REVIEW_SUMMARY_LIMITS.max)
    .describe(description);
}

const mergeRiskSchema = z
  .enum(MERGE_RISK_LEVELS)
  .describe('High-level merge risk.');

export const DefaultOutputSchema = z.strictObject({
  ok: z.boolean().describe('Whether the tool completed successfully.'),
  result: z.unknown().optional().describe('Successful result payload.'),
  error: z
    .strictObject({
      code: z.string().describe('Stable error code for callers.'),
      message: z.string().describe('Human readable error details.'),
      retryable: z
        .boolean()
        .optional()
        .describe('Whether the client should retry this request.'),
      kind: z
        .enum(ERROR_KINDS)
        .optional()
        .describe('Machine-readable error category.'),
    })
    .optional()
    .describe('Error payload when ok is false.'),
});

export const PrImpactResultSchema = z.strictObject({
  severity: z.enum(QUALITY_RISK_LEVELS).describe('Overall severity.'),
  categories: z
    .array(
      z.enum([
        'breaking_change',
        'api_change',
        'schema_change',
        'config_change',
        'dependency_update',
        'security_fix',
        'deprecation',
        'performance_change',
        'bug_fix',
        'feature_addition',
      ])
    )
    .min(0)
    .max(10)
    .describe('Impact categories.'),
  summary: z.string().min(1).max(1000).describe('Concise summary.'),
  breakingChanges: createBoundedStringArray(
    1,
    500,
    0,
    10,
    'Specific breaking changes.'
  ),
  affectedAreas: createBoundedStringArray(
    1,
    200,
    0,
    20,
    'Impacted subsystems/files.'
  ),
  rollbackComplexity: z
    .enum(['trivial', 'moderate', 'complex', 'irreversible'])
    .describe('Revert difficulty.'),
});

export const ReviewSummaryResultSchema = z.strictObject({
  summary: createReviewSummarySchema('PR summary.'),
  overallRisk: mergeRiskSchema,
  keyChanges: createBoundedStringArray(
    1,
    300,
    1,
    15,
    'Key changes (significance desc).'
  ),
  recommendation: z.string().min(1).max(500).describe('Merge recommendation.'),
  stats: z
    .strictObject({
      filesChanged: z.int().min(0).describe('Files changed.'),
      linesAdded: z.int().min(0).describe('Lines added.'),
      linesRemoved: z.int().min(0).describe('Lines removed.'),
    })
    .describe('Change statistics (computed from diff before Gemini call).'),
});

export const TestCaseSchema = z.strictObject({
  name: z.string().min(1).max(200).describe('Test case name.'),
  type: z
    .enum([
      'unit',
      'integration',
      'e2e',
      'regression',
      'security',
      'performance',
    ])
    .describe('Test category.'),
  file: z.string().min(1).max(500).describe('Test file path.'),
  description: z.string().min(1).max(1000).describe('Verification goal.'),
  pseudoCode: z.string().min(1).max(2000).describe('Pseudocode/starter.'),
  priority: z
    .enum(['must_have', 'should_have', 'nice_to_have'])
    .describe('Priority.'),
});

export const TestPlanResultSchema = z.strictObject({
  summary: z.string().min(1).max(1000).describe('Plan overview.'),
  testCases: z
    .array(TestCaseSchema)
    .min(1)
    .max(30)
    .describe('Test cases (must_have first).'),
  coverageSummary: z
    .string()
    .min(1)
    .max(500)
    .describe('Coverage gaps addressed.'),
});

export const AnalyzeComplexityResultSchema = z.strictObject({
  timeComplexity: createBoundedString(
    OUTPUT_LIMITS.complexity.timeComplexity.min,
    OUTPUT_LIMITS.complexity.timeComplexity.max,
    'Big-O time complexity (e.g. O(n log n)).'
  ),
  spaceComplexity: createBoundedString(
    OUTPUT_LIMITS.complexity.spaceComplexity.min,
    OUTPUT_LIMITS.complexity.spaceComplexity.max,
    'Big-O space complexity (e.g. O(n)).'
  ),
  explanation: createBoundedString(
    OUTPUT_LIMITS.complexity.explanation.min,
    OUTPUT_LIMITS.complexity.explanation.max,
    'Analysis explanation (loops, recursion).'
  ),
  potentialBottlenecks: createBoundedStringArray(
    OUTPUT_LIMITS.complexity.bottleneck.min,
    OUTPUT_LIMITS.complexity.bottleneck.max,
    0,
    OUTPUT_LIMITS.complexity.bottleneck.maxItems,
    'Potential bottlenecks.'
  ),
  isDegradation: z.boolean().describe('True if degradation vs original.'),
});

export const DetectApiBreakingResultSchema = z.strictObject({
  hasBreakingChanges: z.boolean().describe('True if breaking.'),
  breakingChanges: z
    .array(
      z.strictObject({
        element: createBoundedString(
          OUTPUT_LIMITS.apiBreaking.element.min,
          OUTPUT_LIMITS.apiBreaking.element.max,
          'Changed element (signature/field/export).'
        ),
        natureOfChange: createBoundedString(
          OUTPUT_LIMITS.apiBreaking.natureOfChange.min,
          OUTPUT_LIMITS.apiBreaking.natureOfChange.max,
          'Change details & breaking reason.'
        ),
        consumerImpact: createBoundedString(
          OUTPUT_LIMITS.apiBreaking.consumerImpact.min,
          OUTPUT_LIMITS.apiBreaking.consumerImpact.max,
          'Consumer impact.'
        ),
        suggestedMitigation: createBoundedString(
          OUTPUT_LIMITS.apiBreaking.suggestedMitigation.min,
          OUTPUT_LIMITS.apiBreaking.suggestedMitigation.max,
          'Mitigation strategy.'
        ),
      })
    )
    .min(0)
    .max(OUTPUT_LIMITS.apiBreaking.maxItems)
    .describe('Breaking changes list.'),
});

const REFACTOR_CATEGORIES = [
  'naming',
  'complexity',
  'duplication',
  'grouping',
] as const;

const REFACTOR_PRIORITIES = ['high', 'medium', 'low'] as const;

export const RefactorSuggestionSchema = z.strictObject({
  category: z.enum(REFACTOR_CATEGORIES).describe('Refactoring category.'),
  target: createBoundedString(
    1,
    300,
    'Function/variable/block name or location.'
  ),
  currentIssue: createBoundedString(1, 500, 'What is wrong.'),
  suggestion: createBoundedString(1, 1000, 'Concrete refactoring suggestion.'),
  priority: z.enum(REFACTOR_PRIORITIES).describe('Suggestion priority.'),
});

export const RefactorCodeGeminiResultSchema = z.strictObject({
  summary: z
    .string()
    .min(1)
    .max(2000)
    .describe('Refactoring analysis summary.'),
  suggestions: z
    .array(RefactorSuggestionSchema)
    .min(0)
    .max(50)
    .describe('Refactoring suggestions.'),
});

export const RefactorCodeResultSchema = RefactorCodeGeminiResultSchema.extend({
  filePath: z.string().describe('Analyzed file path.'),
  language: z.string().describe('Detected/provided language.'),
  namingIssuesCount: z.int().min(0).describe('Naming issues count.'),
  complexityIssuesCount: z.int().min(0).describe('Complexity issues count.'),
  duplicationIssuesCount: z.int().min(0).describe('Duplication issues count.'),
  groupingIssuesCount: z.int().min(0).describe('Grouping issues count.'),
});

export type DefaultOutput = z.infer<typeof DefaultOutputSchema>;
export type PrImpactResult = z.infer<typeof PrImpactResultSchema>;
export type ReviewSummaryResult = z.infer<typeof ReviewSummaryResultSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type TestPlanResult = z.infer<typeof TestPlanResultSchema>;
export type AnalyzeComplexityResult = z.infer<
  typeof AnalyzeComplexityResultSchema
>;
export type DetectApiBreakingResult = z.infer<
  typeof DetectApiBreakingResultSchema
>;
export type RefactorSuggestion = z.infer<typeof RefactorSuggestionSchema>;
export type RefactorCodeGeminiResult = z.infer<
  typeof RefactorCodeGeminiResultSchema
>;
export type RefactorCodeResult = z.infer<typeof RefactorCodeResultSchema>;

const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

export const AskCodeReferenceSchema = z.strictObject({
  target: createBoundedString(
    1,
    300,
    'Function/class/variable/line referenced.'
  ),
  explanation: createBoundedString(
    1,
    500,
    'How this code relates to the answer.'
  ),
});

export const AskGeminiResultSchema = z.strictObject({
  answer: z.string().min(1).max(10_000).describe('Answer to the question.'),
  codeReferences: z
    .array(AskCodeReferenceSchema)
    .min(0)
    .max(20)
    .describe('Specific code elements referenced in the answer.'),
  confidence: z.enum(CONFIDENCE_LEVELS).describe('Confidence in the answer.'),
});

export const AskResultSchema = AskGeminiResultSchema.extend({
  filePath: z.string().describe('Analyzed file path.'),
  language: z.string().describe('Detected/provided language.'),
});

export type AskCodeReference = z.infer<typeof AskCodeReferenceSchema>;
export type AskGeminiResult = z.infer<typeof AskGeminiResultSchema>;
export type AskResult = z.infer<typeof AskResultSchema>;

const EXECUTION_OUTCOMES = [
  'OUTCOME_OK',
  'OUTCOME_FAILED',
  'OUTCOME_DEADLINE_EXCEEDED',
  'OUTCOME_UNSPECIFIED',
] as const;

export const VerifyLogicGeminiResultSchema = z.strictObject({
  answer: z
    .string()
    .min(1)
    .max(10_000)
    .describe('Analysis and conclusion from the verification.'),
  verified: z
    .boolean()
    .describe('True if all execution results passed (OUTCOME_OK).'),
  codeBlocks: z
    .array(
      z.strictObject({
        code: z.string().describe('Generated verification code.'),
        language: z.string().describe('Programming language (e.g. python).'),
      })
    )
    .max(10)
    .describe('Code generated and executed during verification.'),
  executionResults: z
    .array(
      z.strictObject({
        outcome: z.enum(EXECUTION_OUTCOMES).describe('Execution outcome.'),
        output: z.string().describe('stdout on success, stderr on failure.'),
      })
    )
    .max(10)
    .describe('Results from server-side code execution.'),
});

export const VerifyLogicResultSchema = VerifyLogicGeminiResultSchema.extend({
  filePath: z.string().describe('Analyzed file path.'),
  language: z.string().describe('Detected/provided language.'),
});

export type VerifyLogicGeminiResult = z.infer<
  typeof VerifyLogicGeminiResultSchema
>;
export type VerifyLogicResult = z.infer<typeof VerifyLogicResultSchema>;

// ---------------------------------------------------------------------------
// Repository indexing & query
// ---------------------------------------------------------------------------

export const IndexRepositoryResultSchema = z.strictObject({
  storeName: z.string().describe('File Search Store resource name.'),
  displayName: z.string().describe('Human-readable store name.'),
  filesUploaded: z.int().min(0).describe('Files successfully uploaded.'),
  filesSkipped: z
    .int()
    .min(0)
    .describe('Files skipped (binary, too large, denied).'),
  message: z.string().describe('Summary message.'),
});

export type IndexRepositoryResult = z.infer<typeof IndexRepositoryResultSchema>;

export const QueryRepositorySourceSchema = z.strictObject({
  fileSearchStore: z
    .string()
    .max(200)
    .optional()
    .describe('Search store that provided this result.'),
  title: z.string().max(500).optional().describe('Document title.'),
  text: z.string().max(2000).optional().describe('Relevant excerpt.'),
});

export const QueryRepositoryResultSchema = z.strictObject({
  answer: z.string().min(1).max(10_000).describe('Answer to the query.'),
  sources: z
    .array(QueryRepositorySourceSchema)
    .max(20)
    .describe('Source documents cited.'),
});

export type QueryRepositorySource = z.infer<typeof QueryRepositorySourceSchema>;
export type QueryRepositoryResult = z.infer<typeof QueryRepositoryResultSchema>;

// ---------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------

export const WebSearchResultSchema = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(50_000)
    .describe('Formatted search result text with citations.'),
  groundingMetadata: z
    .unknown()
    .describe('Raw grounding metadata from search.'),
});

export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;
