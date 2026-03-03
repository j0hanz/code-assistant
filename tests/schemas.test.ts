import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { z } from 'zod';

import {
  AnalyzeComplexityInputSchema,
  AnalyzePrImpactInputSchema,
  DetectApiBreakingInputSchema,
  DetectCodeSmellsInputSchema,
  GenerateDocumentationInputSchema,
  GenerateReviewSummaryInputSchema,
  GenerateTestPlanInputSchema,
  WebSearchInputSchema,
} from '../src/schemas/inputs.js';
import {
  AnalyzeComplexityResultSchema,
  AskGeminiResultSchema,
  AskResultSchema,
  DefaultOutputSchema,
  DetectApiBreakingResultSchema,
  DetectCodeSmellsGeminiResultSchema,
  DetectCodeSmellsResultSchema,
  GenerateDocumentationGeminiResultSchema,
  GenerateDocumentationResultSchema,
  PrImpactResultSchema,
  RefactorCodeGeminiResultSchema,
  RefactorCodeResultSchema,
  ReviewSummaryResultSchema,
  TestPlanResultSchema,
  VerifyLogicGeminiResultSchema,
  VerifyLogicResultSchema,
} from '../src/schemas/outputs.js';

describe('input schemas', () => {
  it('AnalyzePrImpactInputSchema accepts valid input', () => {
    const result = AnalyzePrImpactInputSchema.safeParse({
      repository: 'owner/repo',
      language: 'TypeScript',
    });
    assert.equal(result.success, true);
  });

  it('AnalyzePrImpactInputSchema accepts minimal input', () => {
    const result = AnalyzePrImpactInputSchema.safeParse({
      repository: 'x',
    });
    assert.equal(result.success, true);
  });

  it('AnalyzePrImpactInputSchema rejects empty repository', () => {
    const result = AnalyzePrImpactInputSchema.safeParse({
      repository: '',
    });
    assert.equal(result.success, false);
  });

  it('AnalyzePrImpactInputSchema rejects unknown fields', () => {
    const result = AnalyzePrImpactInputSchema.safeParse({
      repository: 'owner/repo',
      unknown: true,
    });
    assert.equal(result.success, false);
  });

  it('GenerateTestPlanInputSchema validates maxTestCases bounds', () => {
    const tooLow = GenerateTestPlanInputSchema.safeParse({
      repository: 'owner/repo',
      maxTestCases: 0,
    });
    assert.equal(tooLow.success, false);

    const tooHigh = GenerateTestPlanInputSchema.safeParse({
      repository: 'owner/repo',
      maxTestCases: 31,
    });
    assert.equal(tooHigh.success, false);

    const valid = GenerateTestPlanInputSchema.safeParse({
      repository: 'owner/repo',
      maxTestCases: 15,
    });
    assert.equal(valid.success, true);
  });

  it('GenerateTestPlanInputSchema rejects non-integer maxTestCases', () => {
    const result = GenerateTestPlanInputSchema.safeParse({
      repository: 'owner/repo',
      maxTestCases: 5.5,
    });
    assert.equal(result.success, false);
  });

  it('WebSearchInputSchema rejects empty query', () => {
    const result = WebSearchInputSchema.safeParse({ query: '' });
    assert.equal(result.success, false);
  });

  it('AnalyzeComplexityInputSchema and DetectApiBreakingInputSchema share language', () => {
    for (const schema of [
      AnalyzeComplexityInputSchema,
      DetectApiBreakingInputSchema,
    ]) {
      const withLang = schema.safeParse({ language: 'Go' });
      assert.equal(withLang.success, true);

      const without = schema.safeParse({});
      assert.equal(without.success, true);

      const tooShort = schema.safeParse({ language: 'x' });
      assert.equal(tooShort.success, false);
    }
  });

  it('GenerateDocumentationInputSchema and DetectCodeSmellsInputSchema accept optional language', () => {
    for (const schema of [
      GenerateDocumentationInputSchema,
      DetectCodeSmellsInputSchema,
    ]) {
      assert.equal(schema.safeParse({}).success, true);
      assert.equal(schema.safeParse({ language: 'Python' }).success, true);
      assert.equal(schema.safeParse({ language: 'x' }).success, false);
      assert.equal(
        schema.safeParse({ language: 'Go', extra: true }).success,
        false
      );
    }
  });

  it('GenerateReviewSummaryInputSchema matches AnalyzePrImpactInputSchema shape', () => {
    const input = { repository: 'owner/repo', language: 'Rust' };
    assert.equal(
      GenerateReviewSummaryInputSchema.safeParse(input).success,
      true
    );
    assert.equal(AnalyzePrImpactInputSchema.safeParse(input).success, true);
  });
});

describe('output schemas', () => {
  it('DefaultOutputSchema accepts success payload', () => {
    const result = DefaultOutputSchema.safeParse({
      ok: true,
      result: { data: 'test' },
    });
    assert.equal(result.success, true);
  });

  it('DefaultOutputSchema accepts error payload with all fields', () => {
    const result = DefaultOutputSchema.safeParse({
      ok: false,
      error: {
        code: 'E_TEST',
        message: 'test error',
        retryable: true,
        kind: 'upstream',
      },
    });
    assert.equal(result.success, true);
  });

  it('DefaultOutputSchema rejects invalid error kind', () => {
    const result = DefaultOutputSchema.safeParse({
      ok: false,
      error: {
        code: 'E_TEST',
        message: 'test',
        kind: 'nonexistent',
      },
    });
    assert.equal(result.success, false);
  });

  it('PrImpactResultSchema accepts valid result', () => {
    const result = PrImpactResultSchema.safeParse({
      severity: 'medium',
      categories: ['bug_fix', 'api_change'],
      summary: 'Fixed a critical bug in the API layer.',
      breakingChanges: [],
      affectedAreas: ['src/api/handler.ts'],
      rollbackComplexity: 'trivial',
    });
    assert.equal(result.success, true);
  });

  it('PrImpactResultSchema rejects invalid severity', () => {
    const result = PrImpactResultSchema.safeParse({
      severity: 'extreme',
      categories: [],
      summary: 'test',
      breakingChanges: [],
      affectedAreas: [],
      rollbackComplexity: 'trivial',
    });
    assert.equal(result.success, false);
  });

  it('ReviewSummaryResultSchema validates stats as integers', () => {
    const result = ReviewSummaryResultSchema.safeParse({
      summary: 'A minor refactor.',
      overallRisk: 'low',
      keyChanges: ['Renamed variable'],
      recommendation: 'Merge.',
      stats: { filesChanged: 1.5, linesAdded: 10, linesRemoved: 5 },
    });
    assert.equal(result.success, false);
  });

  it('ReviewSummaryResultSchema accepts valid result', () => {
    const result = ReviewSummaryResultSchema.safeParse({
      summary: 'A minor refactor.',
      overallRisk: 'low',
      keyChanges: ['Renamed variable'],
      recommendation: 'Merge.',
      stats: { filesChanged: 1, linesAdded: 10, linesRemoved: 5 },
    });
    assert.equal(result.success, true);
  });

  it('TestPlanResultSchema accepts empty test cases array', () => {
    const result = TestPlanResultSchema.safeParse({
      summary: 'Plan.',
      testCases: [],
      coverageSummary: 'None.',
    });
    assert.equal(result.success, true);
  });

  it('AnalyzeComplexityResultSchema accepts valid result', () => {
    const result = AnalyzeComplexityResultSchema.safeParse({
      timeComplexity: 'O(n)',
      spaceComplexity: 'O(1)',
      explanation: 'Single loop, constant space.',
      potentialBottlenecks: [],
      isDegradation: false,
    });
    assert.equal(result.success, true);
  });

  it('DetectApiBreakingResultSchema accepts zero breaking changes', () => {
    const result = DetectApiBreakingResultSchema.safeParse({
      hasBreakingChanges: false,
      breakingChanges: [],
    });
    assert.equal(result.success, true);
  });

  it('DetectApiBreakingResultSchema validates breaking change structure', () => {
    const result = DetectApiBreakingResultSchema.safeParse({
      hasBreakingChanges: true,
      breakingChanges: [
        {
          element: 'UserService.getUser()',
          natureOfChange: 'Parameter removed',
          consumerImpact: 'All callers must update signature',
          suggestedMitigation: 'Add overload with old signature',
        },
      ],
    });
    assert.equal(result.success, true);
  });

  it('GenerateDocumentationGeminiResultSchema accepts valid result', () => {
    const result = GenerateDocumentationGeminiResultSchema.safeParse({
      summary: 'File has 3 public exports.',
      docBlocks: [
        {
          target: 'createServer',
          kind: 'function',
          signature: 'function createServer(port: number): Server',
          documentation: 'Creates a new HTTP server on the given port.',
        },
      ],
      totalExports: 3,
    });
    assert.equal(result.success, true);
  });

  it('GenerateDocumentationResultSchema rejects without filePath', () => {
    const result = GenerateDocumentationResultSchema.safeParse({
      summary: 'File has 0 exports.',
      docBlocks: [],
      totalExports: 0,
    });
    assert.equal(result.success, false);
  });

  it('GenerateDocumentationResultSchema accepts full result', () => {
    const result = GenerateDocumentationResultSchema.safeParse({
      summary: 'Fully documented.',
      docBlocks: [],
      totalExports: 0,
      filePath: 'src/index.ts',
      language: 'TypeScript',
      documentedCount: 0,
    });
    assert.equal(result.success, true);
  });

  it('DetectCodeSmellsGeminiResultSchema accepts valid result', () => {
    const result = DetectCodeSmellsGeminiResultSchema.safeParse({
      summary: 'One smell found.',
      smells: [
        {
          type: 'long_function',
          target: 'processData()',
          severity: 'warning',
          explanation: 'Function is 200 lines long.',
          suggestion: 'Extract helper functions.',
        },
      ],
      overallHealth: 'needs_attention',
    });
    assert.equal(result.success, true);
  });

  it('DetectCodeSmellsResultSchema rejects without filePath', () => {
    const result = DetectCodeSmellsResultSchema.safeParse({
      summary: 'Clean file.',
      smells: [],
      overallHealth: 'healthy',
    });
    assert.equal(result.success, false);
  });

  it('DetectCodeSmellsResultSchema accepts full result with counts', () => {
    const result = DetectCodeSmellsResultSchema.safeParse({
      summary: 'Clean file.',
      smells: [],
      overallHealth: 'healthy',
      filePath: 'src/lib/config.ts',
      language: 'TypeScript',
      infoCount: 0,
      warningCount: 0,
      errorCount: 0,
    });
    assert.equal(result.success, true);
  });
});

describe('z.toJSONSchema integration', () => {
  it('all output schemas produce valid JSON Schema', () => {
    const schemas = [
      DefaultOutputSchema,
      PrImpactResultSchema,
      ReviewSummaryResultSchema,
      TestPlanResultSchema,
      AnalyzeComplexityResultSchema,
      DetectApiBreakingResultSchema,
      GenerateDocumentationResultSchema,
      DetectCodeSmellsResultSchema,
    ];

    for (const schema of schemas) {
      const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
      assert.equal(typeof jsonSchema, 'object');
      assert.ok(jsonSchema !== null);
      assert.ok(
        'type' in jsonSchema ||
          '$ref' in jsonSchema ||
          'properties' in jsonSchema
      );
    }
  });

  it('all input schemas produce valid JSON Schema', () => {
    const schemas = [
      AnalyzePrImpactInputSchema,
      GenerateReviewSummaryInputSchema,
      GenerateTestPlanInputSchema,
      AnalyzeComplexityInputSchema,
      DetectApiBreakingInputSchema,
      WebSearchInputSchema,
      GenerateDocumentationInputSchema,
      DetectCodeSmellsInputSchema,
    ];

    for (const schema of schemas) {
      const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
      assert.equal(typeof jsonSchema, 'object');
      assert.ok(jsonSchema !== null);
    }
  });
});

describe('geminiSchema vs resultSchema parse-path', () => {
  const minimalRefactorGeminiResult = {
    summary: 'No refactoring needed.',
    suggestions: [],
  };

  const minimalAskGeminiResult = {
    answer: 'The file exports a single function.',
    codeReferences: [],
    confidence: 'high',
  };

  const minimalVerifyLogicGeminiResult = {
    answer: 'Logic is correct.',
    verified: true,
    codeBlocks: [],
    executionResults: [],
  };

  const minimalDocumentationGeminiResult = {
    summary: 'No public exports.',
    docBlocks: [],
    totalExports: 0,
  };

  const minimalCodeSmellsGeminiResult = {
    summary: 'Clean file.',
    smells: [],
    overallHealth: 'healthy',
  };

  it('RefactorCodeGeminiResultSchema parses without filePath (what Gemini produces)', () => {
    const result = RefactorCodeGeminiResultSchema.safeParse(
      minimalRefactorGeminiResult
    );
    assert.equal(result.success, true);
  });

  it('RefactorCodeResultSchema rejects without filePath (needs transformResult)', () => {
    const result = RefactorCodeResultSchema.safeParse(
      minimalRefactorGeminiResult
    );
    assert.equal(result.success, false);
  });

  it('RefactorCodeResultSchema accepts full result with filePath and counts', () => {
    const result = RefactorCodeResultSchema.safeParse({
      ...minimalRefactorGeminiResult,
      filePath: 'src/server.ts',
      language: 'TypeScript',
      namingIssuesCount: 0,
      complexityIssuesCount: 0,
      duplicationIssuesCount: 0,
      groupingIssuesCount: 0,
    });
    assert.equal(result.success, true);
  });

  it('GenerateDocumentationGeminiResultSchema parses without filePath', () => {
    const result = GenerateDocumentationGeminiResultSchema.safeParse(
      minimalDocumentationGeminiResult
    );
    assert.equal(result.success, true);
  });

  it('GenerateDocumentationResultSchema rejects without filePath', () => {
    const result = GenerateDocumentationResultSchema.safeParse(
      minimalDocumentationGeminiResult
    );
    assert.equal(result.success, false);
  });

  it('DetectCodeSmellsGeminiResultSchema parses without filePath', () => {
    const result = DetectCodeSmellsGeminiResultSchema.safeParse(
      minimalCodeSmellsGeminiResult
    );
    assert.equal(result.success, true);
  });

  it('DetectCodeSmellsResultSchema rejects without filePath', () => {
    const result = DetectCodeSmellsResultSchema.safeParse(
      minimalCodeSmellsGeminiResult
    );
    assert.equal(result.success, false);
  });

  it('AskGeminiResultSchema parses without filePath', () => {
    const result = AskGeminiResultSchema.safeParse(minimalAskGeminiResult);
    assert.equal(result.success, true);
  });

  it('AskResultSchema rejects without filePath', () => {
    const result = AskResultSchema.safeParse(minimalAskGeminiResult);
    assert.equal(result.success, false);
  });

  it('VerifyLogicGeminiResultSchema parses without filePath', () => {
    const result = VerifyLogicGeminiResultSchema.safeParse(
      minimalVerifyLogicGeminiResult
    );
    assert.equal(result.success, true);
  });

  it('VerifyLogicResultSchema rejects without filePath', () => {
    const result = VerifyLogicResultSchema.safeParse(
      minimalVerifyLogicGeminiResult
    );
    assert.equal(result.success, false);
  });

  it('geminiSchema JSON schema omits fields that resultSchema requires (regression)', () => {
    // Ensures the parse-path fix in executeModelCallAttempt stays relevant:
    // if geminiSchema and resultSchema ever become identical, the fix is no
    // longer needed and something likely changed unintentionally.
    const geminiSchemas = [
      { name: 'RefactorCode', schema: RefactorCodeGeminiResultSchema },
      { name: 'Ask', schema: AskGeminiResultSchema },
      { name: 'VerifyLogic', schema: VerifyLogicGeminiResultSchema },
      {
        name: 'GenerateDocumentation',
        schema: GenerateDocumentationGeminiResultSchema,
      },
      { name: 'DetectCodeSmells', schema: DetectCodeSmellsGeminiResultSchema },
    ];
    const resultSchemas = [
      { name: 'RefactorCode', schema: RefactorCodeResultSchema },
      { name: 'Ask', schema: AskResultSchema },
      { name: 'VerifyLogic', schema: VerifyLogicResultSchema },
      {
        name: 'GenerateDocumentation',
        schema: GenerateDocumentationResultSchema,
      },
      { name: 'DetectCodeSmells', schema: DetectCodeSmellsResultSchema },
    ];

    for (let i = 0; i < geminiSchemas.length; i++) {
      const geminiJs = z.toJSONSchema(geminiSchemas[i]!.schema, {
        target: 'draft-2020-12',
      }) as { properties?: Record<string, unknown> };
      const resultJs = z.toJSONSchema(resultSchemas[i]!.schema, {
        target: 'draft-2020-12',
      }) as { properties?: Record<string, unknown> };

      const geminiKeys = new Set(Object.keys(geminiJs.properties ?? {}));
      const resultKeys = new Set(Object.keys(resultJs.properties ?? {}));

      // resultSchema must have strictly more properties than geminiSchema
      assert.ok(
        resultKeys.size > geminiKeys.size,
        `${resultSchemas[i]!.name}: resultSchema should have more properties than geminiSchema`
      );

      // Every geminiSchema key must exist in resultSchema
      for (const key of geminiKeys) {
        assert.ok(
          resultKeys.has(key),
          `${geminiSchemas[i]!.name}: geminiSchema key "${key}" missing from resultSchema`
        );
      }
    }
  });
});
