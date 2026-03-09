import { z } from 'zod';

import {
  createBoundedString,
  createOptionalBoundedInteger,
  createOptionalBoundedString,
} from './helpers.js';

const LANGUAGE_DESCRIPTION =
  'Primary language (e.g. TypeScript, Python, JavaScript, Go, Rust, Java). Auto-infer from files.';

function createLanguageSchema(): z.ZodOptional<z.ZodString> {
  return createOptionalBoundedString(2, 32, LANGUAGE_DESCRIPTION);
}

const LanguageSchema = createLanguageSchema();

export const AnalyzePrImpactInputSchema = z.strictObject({
  language: LanguageSchema,
});

export const GenerateReviewSummaryInputSchema = z.strictObject({
  language: LanguageSchema,
});

export const GenerateTestPlanInputSchema = z.strictObject({
  language: LanguageSchema,
  testFramework: createOptionalBoundedString(
    1,
    50,
    'Test framework (jest, pytest, etc). Auto-infer.'
  ),
  maxTestCases: createOptionalBoundedInteger(
    1,
    30,
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
  maxChars: createOptionalBoundedInteger(
    1,
    50_000,
    'Truncate response text to this many characters. Default: no truncation.'
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
  maxSuggestions: createOptionalBoundedInteger(
    1,
    15,
    'Max suggestions (1-15). Default: 10.'
  ),
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

export const DIFF_MODES = ['unstaged', 'staged'] as const;

export const GenerateDiffInputSchema = z.strictObject({
  mode: z
    .enum(DIFF_MODES)
    .describe(
      '"unstaged": working-tree changes not yet staged. "staged": changes added to the index with git add.'
    ),
});

export type GenerateDiffInput = z.infer<typeof GenerateDiffInputSchema>;

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
