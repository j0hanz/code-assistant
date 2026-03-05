<!-- mcp-name: io.github.j0hanz/code-lens -->

# Code Lens MCP Server

[![npm version](https://img.shields.io/npm/v/%40j0hanz%2Fcode-lens?style=flat-square&logo=npm)](https://www.npmjs.com/package/%40j0hanz%2Fcode-lens) [![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](#contributing-and-license)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=code-lens&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Fcode-lens%40latest%22%5D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_Server-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=code-lens&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Fcode-lens%40latest%22%5D%7D&quality=insiders) [![Install in Visual Studio](https://img.shields.io/badge/Visual_Studio-Install_Server-C16FDE?logo=visualstudio&logoColor=white)](https://vs-open.link/mcp-install?%7B%22code-lens%22%3A%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Fcode-lens%40latest%22%5D%7D%7D)

[![Add to LM Studio](https://files.lmstudio.ai/deeplink/mcp-install-light.svg)](https://lmstudio.ai/install-mcp?name=code-lens&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovY29kZS1sZW5zQGxhdGVzdCJdfQ==) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=code-lens&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovY29kZS1sZW5zQGxhdGVzdCJdfQ==) [![Install in Goose](https://block.github.io/goose/img/extension-install-dark.svg)](https://block.github.io/goose/extension?cmd=npx&arg=-y&arg=%40j0hanz%2Fcode-lens%40latest&id=%40j0hanz%2Fcode-lens&name=code-lens&description=Gemini-powered%20MCP%20server%20for%20code%20analysis.)

Gemini-powered MCP server for automated code review, analysis, and documentation.

## Overview

Code Lens is a [Model Context Protocol](https://modelcontextprotocol.io/) server that uses Google Gemini to analyze diffs, review pull requests, detect code smells, generate documentation, and verify logic. It exposes 13 tools, 7 resources, and 5 prompts over stdio transport.

## Key Features

- **PR review pipeline** — generate diffs, assess impact, detect breaking API changes, and produce review summaries with merge recommendations
- **File analysis** — load any source file for refactoring suggestions, code smell detection, documentation generation, and natural-language Q&A
- **Logic verification** — verify algorithms using Gemini's code execution sandbox
- **Structured outputs** — all tools return validated JSON via Zod v4 output schemas
- **Web search** — Google Search with Grounding for up-to-date information retrieval

## Requirements

- Node.js >= 24
- A [Gemini API key](https://aistudio.google.com/apikey) (`GEMINI_API_KEY` or `GOOGLE_API_KEY`)

## Quick Start

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Docker

```bash
docker run -i --rm -e GEMINI_API_KEY="your-api-key" ghcr.io/j0hanz/code-lens
```

Or with Docker Compose:

```bash
GEMINI_API_KEY=your-api-key docker compose up
```

## Client Configuration

<details>
<summary><b>Install in VS Code</b></summary>

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=code-lens&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Fcode-lens%40latest%22%5D%7D)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or install via CLI:

```sh
code --add-mcp '{"name":"code-lens","command":"npx","args":["-y","@j0hanz/code-lens@latest"]}'
```

For more info, see [VS Code MCP docs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).

</details>

<details>
<summary><b>Install in VS Code Insiders</b></summary>

[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_Server-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=code-lens&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Fcode-lens%40latest%22%5D%7D&quality=insiders)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or install via CLI:

```sh
code-insiders --add-mcp '{"name":"code-lens","command":"npx","args":["-y","@j0hanz/code-lens@latest"]}'
```

For more info, see [VS Code Insiders MCP docs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).

</details>

<details>
<summary><b>Install in Cursor</b></summary>

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=code-lens&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovY29kZS1sZW5zQGxhdGVzdCJdfQ==)

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol).

</details>

<details>
<summary><b>Install in Visual Studio</b></summary>

[![Install in Visual Studio](https://img.shields.io/badge/Visual_Studio-Install_Server-C16FDE?logo=visualstudio&logoColor=white)](https://vs-open.link/mcp-install?%7B%22code-lens%22%3A%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Fcode-lens%40latest%22%5D%7D%7D)

Add to `mcp.json`:

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Visual Studio MCP docs](https://learn.microsoft.com/en-us/visualstudio/ide/mcp-servers).

</details>

<details>
<summary><b>Install in Goose</b></summary>

[![Install in Goose](https://block.github.io/goose/img/extension-install-dark.svg)](https://block.github.io/goose/extension?cmd=npx&arg=-y&arg=%40j0hanz%2Fcode-lens%40latest&id=%40j0hanz%2Fcode-lens&name=code-lens&description=Gemini-powered%20MCP%20server%20for%20code%20analysis.)

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Goose MCP docs](https://block.github.io/goose/docs/getting-started/using-extensions).

</details>

<details>
<summary><b>Install in LM Studio</b></summary>

[![Add to LM Studio](https://files.lmstudio.ai/deeplink/mcp-install-light.svg)](https://lmstudio.ai/install-mcp?name=code-lens&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovY29kZS1sZW5zQGxhdGVzdCJdfQ==)

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [LM Studio MCP docs](https://lmstudio.ai/docs/basics/mcp).

</details>

<details>
<summary><b>Install in Claude Desktop</b></summary>

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Claude Desktop MCP docs](https://modelcontextprotocol.io/quickstart/user).

</details>

<details>
<summary><b>Install in Claude Code</b></summary>

```sh
claude mcp add code-lens -- npx -y @j0hanz/code-lens@latest
```

Or add to config:

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Claude Code MCP docs](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/tutorials#set-up-model-context-protocol-mcp).

</details>

<details>
<summary><b>Install in Windsurf</b></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Windsurf MCP docs](https://docs.windsurf.com/windsurf/mcp).

</details>

<details>
<summary><b>Install in Amp</b></summary>

```sh
amp mcp add code-lens -- npx -y @j0hanz/code-lens@latest
```

Or add to config:

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Amp MCP docs](https://docs.amp.dev).

</details>

<details>
<summary><b>Install in Cline</b></summary>

Add to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Cline MCP docs](https://docs.cline.bot/mcp-servers/configuring-mcp-servers).

</details>

<details>
<summary><b>Install in Codex CLI</b></summary>

Add to `~/.codex/config.yaml`:

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Codex CLI MCP docs](https://github.com/openai/codex).

</details>

<details>
<summary><b>Install in GitHub Copilot</b></summary>

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [GitHub Copilot MCP docs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).

</details>

<details>
<summary><b>Install in Warp</b></summary>

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Warp MCP docs](https://docs.warp.dev/features/mcp-model-context-protocol).

</details>

<details>
<summary><b>Install in Kiro</b></summary>

Add to `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Kiro MCP docs](https://kiro.dev/docs/mcp/overview/).

</details>

<details>
<summary><b>Install in Gemini CLI</b></summary>

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Gemini CLI MCP docs](https://github.com/google-gemini/gemini-cli).

</details>

<details>
<summary><b>Install in Zed</b></summary>

Add to `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "code-lens": {
      "settings": {
        "command": "npx",
        "args": ["-y", "@j0hanz/code-lens@latest"]
      }
    }
  }
}
```

For more info, see [Zed MCP docs](https://zed.dev/docs/assistant/model-context-protocol).

</details>

<details>
<summary><b>Install in Augment</b></summary>

Add to your VS Code `settings.json` under `augment.advanced`:

```json
{
  "augment.advanced": {
    "mcpServers": [
      {
        "id": "code-lens",
        "command": "npx",
        "args": ["-y", "@j0hanz/code-lens@latest"],
        "env": {
          "GEMINI_API_KEY": "your-api-key"
        }
      }
    ]
  }
}
```

For more info, see [Augment MCP docs](https://docs.augmentcode.com/setup-mcp-servers).

</details>

<details>
<summary><b>Install in Roo Code</b></summary>

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Roo Code MCP docs](https://docs.roocode.com/features/mcp/using-mcp-in-roo).

</details>

<details>
<summary><b>Install in Kilo Code</b></summary>

```json
{
  "mcpServers": {
    "code-lens": {
      "command": "npx",
      "args": ["-y", "@j0hanz/code-lens@latest"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

For more info, see [Kilo Code MCP docs](https://kilocode.ai/docs/features/mcp/using-mcp-servers).

</details>

## Use Cases

### PR Review Pipeline

1. Call `generate_diff` to capture unstaged or staged changes
2. Run `analyze_pr_impact` to assess severity and breaking changes
3. Run `generate_review_summary` for a risk rating and merge recommendation
4. Run `detect_api_breaking_changes` to check for public API breakage
5. Run `generate_test_plan` to produce prioritized test cases

### Single-File Analysis

1. Call `load_file` to cache a source file
2. Run `refactor_code` for structural improvement suggestions
3. Run `detect_code_smells` for Fowler-taxonomy anti-patterns
4. Run `generate_documentation` to generate JSDoc/TSDoc stubs
5. Use `ask_about_code` for natural-language Q&A about the file
6. Use `verify_logic` to verify algorithms with code execution

### Performance Audit

1. Call `generate_diff` on a performance-sensitive change
2. Run `analyze_time_space_complexity` to detect Big-O degradation

### Research

- Use `web_search` for up-to-date documentation or API references via Google Search with Grounding

## Architecture

```text
[MCP Client]
    │
    │ Transport: stdio
    ▼
[MCP Server: code-lens]
    │ Entry: src/index.ts → src/server.ts
    │
    ├── initialize / initialized (lifecycle handshake)
    │
    ├── tools/call ──────────────────────────────────────────────
    │   │
    │   │ Diff-based tools (require generate_diff first):
    │   ├── [generate_diff]              Sync — capture git diff
    │   ├── [analyze_pr_impact]          Flash — severity & impact
    │   ├── [generate_review_summary]    Flash — risk & merge rec
    │   ├── [generate_test_plan]         Flash — test cases
    │   ├── [analyze_time_space_complexity] Flash — Big-O analysis
    │   ├── [detect_api_breaking_changes]  Flash — API breakage
    │   │
    │   │ File-based tools (require load_file first):
    │   ├── [load_file]                  Sync — cache source file
    │   ├── [refactor_code]              Flash — refactoring
    │   ├── [detect_code_smells]         Flash — smell detection
    │   ├── [generate_documentation]     Flash — doc stubs
    │   ├── [ask_about_code]             Flash — Q&A
    │   ├── [verify_logic]               Flash — code execution
    │   │
    │   │ Standalone:
    │   └── [web_search]                 Flash — Google Search
    │
    ├── resources/read ──────────────────────────────────────────
    │   ├── [internal://instructions]        Server usage guide
    │   ├── [internal://tool-catalog]        Tool reference
    │   ├── [internal://workflows]           Workflow sequences
    │   ├── [internal://server-config]       Runtime config
    │   ├── [internal://tool-info/{name}]    Per-tool details
    │   ├── [internal://diff/current]        Cached diff (text/x-patch)
    │   └── [internal://file/current]        Cached source file
    │
    ├── prompts/get ─────────────────────────────────────────────
    │   ├── [get-help]           Full server instructions
    │   ├── [review-guide]       Tool + focus area workflow
    │   ├── [select-workflow]    Pipeline by change type
    │   ├── [analyze-file]       File analysis pipeline
    │   └── [tool-chain]         Tool prerequisite chain
    │
    └── Capabilities: structured output, tool annotations, notifications
```

### Request Lifecycle

```text
[Client] -- initialize {protocolVersion, capabilities} --> [Server]
[Server] -- {protocolVersion, capabilities, serverInfo} --> [Client]
[Client] -- notifications/initialized --> [Server]
[Client] -- tools/call {name, arguments} --> [Server]
[Server] -- notifications/progress {token, progress, total} --> [Client]
[Server] -- {content, structuredContent, isError?} --> [Client]
```

## MCP Surface

### Tools

| Tool                            | Description                                                        | Prerequisite    | Model |
| ------------------------------- | ------------------------------------------------------------------ | --------------- | ----- |
| `generate_diff`                 | Capture git diff (unstaged/staged) and cache server-side           | —               | Sync  |
| `analyze_pr_impact`             | Assess severity, categories, breaking changes, rollback complexity | `generate_diff` | Flash |
| `generate_review_summary`       | PR summary, risk rating, merge recommendation                      | `generate_diff` | Flash |
| `generate_test_plan`            | Prioritized test cases and coverage guidance                       | `generate_diff` | Flash |
| `analyze_time_space_complexity` | Big-O complexity analysis and degradation detection                | `generate_diff` | Flash |
| `detect_api_breaking_changes`   | Detect breaking API/interface changes                              | `generate_diff` | Flash |
| `load_file`                     | Cache a source file for analysis tools                             | —               | Sync  |
| `refactor_code`                 | Complexity, duplication, naming, grouping suggestions              | `load_file`     | Flash |
| `detect_code_smells`            | Structural code smells (Fowler taxonomy)                           | `load_file`     | Flash |
| `generate_documentation`        | JSDoc/TSDoc/docstring stubs for public exports                     | `load_file`     | Flash |
| `ask_about_code`                | Natural-language Q&A about a cached file                           | `load_file`     | Flash |
| `verify_logic`                  | Verify algorithms via Gemini code execution sandbox                | `load_file`     | Flash |
| `web_search`                    | Google Search with Grounding                                       | —               | Flash |

### Resources

| URI                               | Description                                        | MIME            |
| --------------------------------- | -------------------------------------------------- | --------------- |
| `internal://instructions`         | Complete server usage instructions                 | `text/markdown` |
| `internal://tool-catalog`         | Tool reference: models, params, outputs, data flow | `text/markdown` |
| `internal://workflows`            | Recommended workflows and tool sequences           | `text/markdown` |
| `internal://server-config`        | Runtime configuration and limits                   | `text/markdown` |
| `internal://tool-info/{toolName}` | Per-tool details (parameterized)                   | `text/markdown` |
| `internal://diff/current`         | Most recently generated diff                       | `text/x-patch`  |
| `internal://file/current`         | Most recently loaded source file                   | `text/plain`    |

### Prompts

| Prompt            | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `get-help`        | Full server instructions: capabilities, tools, resources, constraints |
| `review-guide`    | Workflow guide for a specific tool and focus area                     |
| `select-workflow` | Recommended tool pipeline based on change type                        |
| `analyze-file`    | Goal-based tool pipeline for single-file analysis                     |
| `tool-chain`      | Full prerequisite chain for a given tool                              |

## MCP Capabilities

### Tool Annotations

All tools expose MCP tool annotations:

| Annotation        | Used |
| ----------------- | ---- |
| `readOnlyHint`    | Yes  |
| `destructiveHint` | Yes  |
| `idempotentHint`  | Yes  |
| `openWorldHint`   | Yes  |

### Structured Output

All Gemini-powered tools return validated `structuredContent` alongside text `content`, using Zod v4 output schemas.

## Configuration

| Variable                       | Default                  | Description                                                                                                 |
| ------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`               | —                        | **Required.** Gemini API key. Falls back to `GOOGLE_API_KEY`.                                               |
| `GEMINI_MODEL`                 | `gemini-3-flash-preview` | Override the default Gemini model for all tools.                                                            |
| `MAX_DIFF_CHARS`               | `120000`                 | Maximum diff size in characters.                                                                            |
| `MAX_CONCURRENT_CALLS`         | `10`                     | Maximum concurrent Gemini API calls.                                                                        |
| `MAX_CONCURRENT_BATCH_CALLS`   | `2`                      | Maximum concurrent batch Gemini calls.                                                                      |
| `MAX_CONCURRENT_CALLS_WAIT_MS` | `2000`                   | Wait timeout for concurrency semaphore.                                                                     |
| `GEMINI_BATCH_MODE`            | `off`                    | Enable Gemini batch mode.                                                                                   |
| `GEMINI_HARM_BLOCK_THRESHOLD`  | `BLOCK_NONE`             | Safety filter threshold (`BLOCK_NONE`, `BLOCK_ONLY_HIGH`, `BLOCK_MEDIUM_AND_ABOVE`, `BLOCK_LOW_AND_ABOVE`). |
| `GEMINI_DIFF_CACHE_ENABLED`    | `false`                  | Enable Gemini context caching for large diffs.                                                              |
| `GEMINI_DIFF_CACHE_TTL_S`      | `3600`                   | Cache TTL in seconds (when caching is enabled).                                                             |

### CLI Flags

```bash
npx @j0hanz/code-lens@latest --model gemini-2.5-flash --max-diff-chars 200000
```

| Flag               | Env Equivalent   |
| ------------------ | ---------------- |
| `--model`, `-m`    | `GEMINI_MODEL`   |
| `--max-diff-chars` | `MAX_DIFF_CHARS` |

## Security

| Control            | Status                                           |
| ------------------ | ------------------------------------------------ |
| Input validation   | Zod v4 schema validation on all tool inputs      |
| Path safety        | `load_file` restricts paths to workspace root    |
| Stdout safety      | Logs to stderr; stdout reserved for MCP protocol |
| Non-root container | Docker runs as dedicated `mcp` user              |

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm run dev:run      # Run with --watch and .env
npm run start        # Run compiled server
npm run type-check   # Type-check src + tests
npm run lint         # ESLint
npm run test         # Run test suite
npm run format       # Prettier
npm run inspector    # MCP Inspector
npm run knip         # Dead code detection
```

## Build and Release

- CI: `.github/workflows/release.yml`
- Docker: Multi-stage build (`Dockerfile`) with `node:24-alpine`
- Docker Compose: `docker-compose.yml`
- npm: Published as [`@j0hanz/code-lens`](https://www.npmjs.com/package/@j0hanz/code-lens)

## Troubleshooting

- **Missing API key**: Set `GEMINI_API_KEY` or `GOOGLE_API_KEY` in your environment or client config `env` block.
- **"E_NO_DIFF" errors**: Call `generate_diff` before running any diff-based review tool.
- **"E_NO_FILE" errors**: Call `load_file` before running any file analysis tool.
- **Large diffs truncated**: Increase `MAX_DIFF_CHARS` (default: 120,000 characters).
- **Stdout noise**: Ensure no other processes write to stdout; the server uses stdio transport.

## Credits

- [Google Gemini](https://ai.google.dev/) — LLM backend (`@google/genai`)
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) — MCP framework (`@modelcontextprotocol/sdk`)
- [Zod](https://zod.dev/) — Schema validation (`zod` v4)
- [parse-diff](https://www.npmjs.com/package/parse-diff) — Diff parsing

## Contributing and License

MIT License. See [LICENSE](LICENSE) for details.

Contributions welcome via [pull requests](https://github.com/j0hanz/code-lens/pulls).
