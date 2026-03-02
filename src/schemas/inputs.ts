import { z } from 'zod';

import { createBoundedString, createOptionalBoundedString } from './helpers.js';

const INPUT_LIMITS = {
  repository: { min: 1, max: 200 },
  language: { min: 2, max: 32 },
  testFramework: { min: 1, max: 50 },
  maxTestCases: { min: 1, max: 30 },
} as const;

const LANGUAGE_DESCRIPTION =
  'Primary language (e.g. TypeScript). Auto-infer from files.';

const REPOSITORY_DESCRIPTION = 'Repo ID (owner/repo). Auto-infer from git/dir.';

function createLanguageSchema(): z.ZodOptional<z.ZodString> {
  return createOptionalBoundedString(
    INPUT_LIMITS.language.min,
    INPUT_LIMITS.language.max,
    LANGUAGE_DESCRIPTION
  );
}

function createRepositorySchema(): z.ZodString {
  return createBoundedString(
    INPUT_LIMITS.repository.min,
    INPUT_LIMITS.repository.max,
    REPOSITORY_DESCRIPTION
  );
}

function createOptionalBoundedInteger(
  min: number,
  max: number,
  description: string
): z.ZodOptional<z.ZodInt> {
  return z.int().min(min).max(max).optional().describe(description);
}

const RepositorySchema = createRepositorySchema();
const LanguageSchema = createLanguageSchema();

export const AnalyzePrImpactInputSchema = z.strictObject({
  repository: RepositorySchema,
  language: LanguageSchema,
});

export const GenerateReviewSummaryInputSchema = z.strictObject({
  repository: RepositorySchema,
  language: LanguageSchema,
});

export const GenerateTestPlanInputSchema = z.strictObject({
  repository: RepositorySchema,
  language: LanguageSchema,
  testFramework: createOptionalBoundedString(
    INPUT_LIMITS.testFramework.min,
    INPUT_LIMITS.testFramework.max,
    'Test framework (jest, pytest, etc). Auto-infer.'
  ),
  maxTestCases: createOptionalBoundedInteger(
    INPUT_LIMITS.maxTestCases.min,
    INPUT_LIMITS.maxTestCases.max,
    'Max test cases (1-30). Default: 15.'
  ),
});

export const AnalyzeComplexityInputSchema = z.strictObject({
  language: LanguageSchema,
});

export const DetectApiBreakingInputSchema = z.strictObject({
  language: LanguageSchema,
});

const WEB_SEARCH_RESPONSE_STYLES = [
  'concise',
  'detailed',
  'bullets',
  'code_focused',
] as const;

export const WebSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(1000).describe('Search query.'),
  topic: createOptionalBoundedString(
    2,
    100,
    'Domain focus (e.g. "TypeScript", "Docker"). Set to avoid irrelevant results.'
  ),
  responseStyle: z
    .enum(WEB_SEARCH_RESPONSE_STYLES)
    .default('concise')
    .describe(
      'concise: 2-4 sentences. detailed: full explanation. bullets: list. code_focused: code snippets.'
    ),
});

export const LoadFileInputSchema = z.strictObject({
  filePath: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'File path relative to workspace root (e.g. src/index.ts) or absolute. Must be within workspace.'
    ),
});

export const RefactorCodeInputSchema = z.strictObject({
  language: LanguageSchema,
});

export const GenerateDocumentationInputSchema = z.strictObject({
  language: LanguageSchema,
});

export const DetectCodeSmellsInputSchema = z.strictObject({
  language: LanguageSchema,
});

export const AskInputSchema = z.strictObject({
  question: createBoundedString(1, 2000, 'Question about the loaded file.'),
  language: LanguageSchema,
});

export const VerifyLogicInputSchema = z.strictObject({
  question: createBoundedString(
    1,
    2000,
    'What to verify in the loaded file (e.g. algorithm correctness, edge cases).'
  ),
  language: LanguageSchema,
});

export type AnalyzePrImpactInput = z.infer<typeof AnalyzePrImpactInputSchema>;
export type GenerateDocumentationInput = z.infer<
  typeof GenerateDocumentationInputSchema
>;
export type DetectCodeSmellsInput = z.infer<typeof DetectCodeSmellsInputSchema>;
export type GenerateReviewSummaryInput = z.infer<
  typeof GenerateReviewSummaryInputSchema
>;
export type GenerateTestPlanInput = z.infer<typeof GenerateTestPlanInputSchema>;
export type AnalyzeComplexityInput = z.infer<
  typeof AnalyzeComplexityInputSchema
>;
export type DetectApiBreakingInput = z.infer<
  typeof DetectApiBreakingInputSchema
>;
export type WebSearchInput = z.infer<typeof WebSearchInputSchema>;
export type LoadFileInput = z.infer<typeof LoadFileInputSchema>;
export type RefactorCodeInput = z.infer<typeof RefactorCodeInputSchema>;
export type AskInput = z.infer<typeof AskInputSchema>;
export type VerifyLogicInput = z.infer<typeof VerifyLogicInputSchema>;
