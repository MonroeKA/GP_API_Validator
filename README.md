# Global Payments API Validator

Automated tool to extract and test API endpoints from Global Payments developer documentation.

<img width="1232" height="848" alt="image" src="https://github.com/user-attachments/assets/e1785776-3535-41d6-a095-08149e6c04fd" />

## Features

- **Automated Extraction**: Scrapes API documentation using Playwright
  - Extracts code snippets from API Explorer pages and rendered integration guides
  - Discovers every executable Global Payments cURL request in guide code blocks
  - Extracts code snippets in multiple languages (JSON, cURL)
  - Captures request structure (URL, headers, body)
  - Extracts documented HTTP status codes, and the endpoint-specific `error_code` values Global Payments documents for each non-2xx status
  - Handles multi-tab JSON structure (URL & QUERY, HEADERS, BODY)
  - Single-block extraction for cURL commands

- **Live API Testing**: Tests extracted endpoints against the actual API
  - Generates fresh OAuth 2.0 tokens
  - Verifies sandbox authentication through the official Global Payments Node.js SDK
  - Tests multiple HTTP status code scenarios
  - Validates both the HTTP status code *and* that the response body's `error_code`/payload actually matches what's documented for that scenario - a status code alone isn't treated as a pass
  - Skips scenarios (e.g. 500/501/502/504) that can't be safely or deterministically reproduced against the sandbox, and reports them as such instead of a false failure
  - Records test results with timestamps

- **Web Dashboard**: Interactive UI to view results
  - View extracted API data
  - Display code snippets with syntax highlighting
  - Compare documented vs actual responses
  - Load historical test results

## Setup

1. Clone the repository:
```bash
git clone https://github.com/MonroeKA/GP_API_Validator.git
cd GP_API_Validator
```

2. Install dependencies:
```bash
npm install
```

3. Install the PHP and Java SDK verifiers:
```bash
cd sdk-verifiers/php
composer install
cd ../java
mvn package -DskipTests
mvn dependency:build-classpath -Dmdep.outputFile=classpath.txt
cd ../..
```
The Node.js SDK verifier (`sdk-verifiers/node/verify.js`) needs no separate install step — it uses the `globalpayments-api` package already installed by `npm install` at the repo root.

This requires PHP 8+, Composer, Java 8+, and Maven. The Java verifier uses the Developer Portal version `15.1.14`. The PHP portal still lists `2.0.0`, which predates the GP API authentication classes, so the verifier uses the current official release, `14.4.2`.

4. Install Playwright browsers:
```bash
npx playwright install firefox
```

5. Create `.env` file from the example:
```bash
cp .env.example .env
```

6. Edit `.env` and add your Global Payments API credentials:
```
GP_API_APP_ID=your_app_id_here
GP_API_APP_KEY=your_app_key_here
```

Get your credentials from the [Global Payments Developer Portal](https://developer.globalpayments.com/)

## Usage

1. Start the server:
```bash
node server.js
```

2. Open the dashboard:
```
http://localhost:3000
```

3. Enter a Global Payments API documentation URL and choose your options:
   
    &#10003; Run live API test after extraction

    &#10003; Save extraction results to file
   
   - **Extract** - Run with the above options

## CI/CD Pipeline Usage

The dashboard above is for interactive, one-URL-at-a-time use. For automated pipelines,
use `cli.js`, a headless batch entrypoint that validates a list of documentation URLs
with no browser UI involved and reports results in machine-readable form.

```bash
# Validate every URL listed in endpoints.json (extraction + live sandbox test + SDK verification)
node cli.js

# Validate a single URL
node cli.js --url "https://developer.globalpayments.com/api/accounts#/..."

# Validate a custom list of URLs
node cli.js --urls-file path/to/endpoints.json

# Skip live sandbox API calls - just confirm the docs page can still be parsed
node cli.js --extract-only

# Control report locations
node cli.js --out results/report.json --junit results/report.junit.xml
```

Run `node cli.js --help` for the full flag reference (timeouts, `--report-only`, `--quiet`, etc).

**Exit codes** a pipeline can branch on:
| Code | Meaning |
|------|---------|
| `0` | Every tracked endpoint passed |
| `1` | The tool ran fine but found a documentation/API mismatch |
| `2` | The tool itself failed (bad config, missing credentials, crash, timeout) |

**Tracked endpoints** ([endpoints.json](endpoints.json)) is a checked-in list of developer-portal
URLs to validate, so adding a new page to watch is a normal, reviewable PR:
```json
[
  { "name": "Retrieve a List of Accounts", "url": "https://developer.globalpayments.com/api/accounts#/...", "liveTest": true }
]
```
A plain array of URL strings also works; `liveTest` defaults to `true` and can be set to `false`
per-entry to only ever run extraction (no sandbox API calls) for that page.

**Reports**: every run writes a JSON report and a JUnit XML report (consumable by most CI
test-reporting integrations) to `results/` by default. These are gitignored - treat them as
build artifacts, not committed files.

**Credentials**: `cli.js` reads `GP_API_APP_ID`/`GP_API_APP_KEY`/`GP_API_ENVIRONMENT` from real
process environment variables first (e.g. CI secrets), falling back to a local `.env` file only
if those aren't already set - so no credentials file needs to be written to disk in a pipeline
workspace.

### Docker

[Dockerfile](Dockerfile) builds a self-contained image (based on Microsoft's official Playwright
image, with the Java/Maven and PHP/Composer toolchains needed by `sdk-verifiers/` layered on top)
so a pipeline doesn't need to install browsers or multiple language runtimes on every run:

```bash
docker build -t gp-api-validator:ci .
docker run --rm \
  -e GP_API_APP_ID -e GP_API_APP_KEY -e GP_API_ENVIRONMENT=sandbox \
  -v "$(pwd)/results:/app/results" \
  gp-api-validator:ci --out /app/results/report.json --junit /app/results/report.junit.xml
```

### GitHub Actions

[.github/workflows/gp-api-validation.yml](.github/workflows/gp-api-validation.yml) builds and runs
the Docker image above:
- **Nightly (`schedule`)**: full validation (extraction + live sandbox test + SDK verification) of
  every URL in `endpoints.json`, so developer-portal drift is caught even when nothing in this
  repo changed. Opens a GitHub issue automatically if it fails.
- **`push` to `endpoints.json`**: validates newly-tracked URLs immediately.
- **`pull_request`** touching the extraction/testing engine (`lib/pipeline.js`, `cli.js`,
  `server.js`, `Dockerfile`): a fast `--extract-only` smoke test that needs no sandbox credentials,
  so it also runs on PRs from forks.
- **`workflow_dispatch`**: on-demand run, optionally against a single URL.

Set the following as [repository secrets](../../settings/secrets/actions) for the scheduled/push/
dispatch runs to be able to reach the sandbox API:
- `GP_API_APP_ID`
- `GP_API_APP_KEY`

## Example URLs

- `https://developer.globalpayments.com/api/accounts#/Retrieve%20a%20List%20of%20Accounts/retrieveAListOfAccounts`
- `https://developer.globalpayments.com/api/links#/Create%20a%20link/post-links`


## Architecture

### Shared engine (`lib/pipeline.js`)
- Extraction (`extractFromUrl`), live API testing (`testAllSnippets`), and SDK verification
  (`verifyAllGlobalPaymentsSdks`) live here, independent of any HTTP server or CLI framing
- Imported by both `server.js` (interactive dashboard) and `cli.js` (headless pipeline entrypoint)
  so the two never drift apart

### Backend (`server.js`)
- Express server on port 3000
- Playwright-based web scraper (Firefox headless)
- Delegates to standalone `sdk-verifiers/node`, `sdk-verifiers/php`, and `sdk-verifiers/java` scripts for official SDK authentication verification
- OAuth 2.0 token generation with SHA512 secrets
- Raw HTTP endpoint testing with scenario coverage

### CI/CD entrypoint (`cli.js`)
- Headless batch runner for pipelines - see [CI/CD Pipeline Usage](#cicd-pipeline-usage) above


### Frontend (`frontend.html`)
- Interactive dashboard with tabbed interface
- Syntax highlighting for code snippets
- Real-time extraction status
- Historical results browser

### Extraction Process
1. Navigate to documentation page
2. Detect API Explorer controls or rendered guide code blocks
3. For API Explorer pages, process each language:
   - Switch language if needed (2s wait for UI update)
   - JSON: Extract from 3 tabs (URL & QUERY, HEADERS, BODY)
   - cURL: Extract single complete command
4. For guide pages, extract and label every GP API cURL request from Playwright-rendered `<pre>` blocks
5. Parse each request's method, URL, headers, and body
6. Extract the documented response codes, then step through each one in the response-code selector to read the endpoint-specific `error_code` values Global Payments documents for it (the "possible values" list next to the `error_code` field)
7. Test each parsed request independently against every documented status code, then run SDK verification as an additional stage

## API Endpoints

- `POST /api/extract` - Extract and optionally test an API endpoint
  ```json
  {
    "url": "https://developer.globalpayments.com/api/...",
    "runLiveTest": true
  }
  ```

- `GET /api/health` - Health check
- `GET /api/sdk-verification` - Verify configured credentials through the Node.js, PHP, and Java SDKs
- `GET /api/list-results` - List saved extraction results  
- `GET /api/load-result/:filename` - Load a specific result file

## Output Files

- `extraction-results-{timestamp}.json` - Complete extraction and test data
- `gp-access-token.json` - Generated OAuth 2.0 access token (auto-refreshed)

## Security

⚠️ **Important**: Never commit your `.env` file or any files containing API credentials. These files are excluded in `.gitignore`.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
- `gp-access-token.json` - Current OAuth token (auto-generated)

## Configuration Files

- `.env` - API credentials (gitignored)
- `config/credentials.json` - Alternative credentials storage (gitignored)
  
## Dependencies

- `express` - Web server framework
- `globalpayments-api` - Official Global Payments Node.js SDK
- `playwright` - Browser automation for scraping
- Node.js 18+ (native fetch support)

## Technical Details

### Language Detection
- Finds dropdown with class `request-switcher`
- Extracts available languages from dropdown menu items
- Case-insensitive matching (handles "cURL" vs "curl")

### Tab Structure
- JSON uses container `.api-explorer__try-it__json` with sub-tabs
- cURL uses container `.api-explorer__try-it__curl` with single code block
- Waits 2 seconds after language switch for DOM update

### Token Generation
- Uses OAuth 2.0 client credentials flow
- Secret = SHA512(nonce + appKey)
- Tokens valid for ~24 hours
- Auto-refreshes on each test run

### Validation Layers
- SDK verification authenticates with the official Node.js, PHP, and Java SDKs using the configured sandbox credentials
- Each language runs as an isolated subprocess script (`sdk-verifiers/node/verify.js`, `sdk-verifiers/php/verify.php`, `sdk-verifiers/java/src/main/java/SdkVerifier.java`) that prints a single JSON result line, so the three SDKs stay independent of the Node.js server's own dependency versions
- HTTP validation replays extracted requests because the SDK does not expose every documented endpoint as a generic operation
- A status code scenario is only reported as "matched" when **both** the HTTP status and the response content line up with the documentation:
  - For error scenarios (400/401/403/404/...), the response's `error_code` must be one of the values scraped for that endpoint + status (falling back to a generic reference table from Global Payments' [response definitions](https://developer.globalpayments.com/api/definitions/responses) if nothing endpoint-specific was found)
  - For 2xx scenarios, the response body must not contain an error payload
  - A coincidentally-correct HTTP status with an unrelated error body (e.g. a mistakenly-mangled URL returning 404 with a transaction-related error instead of `RESOURCE_NOT_FOUND`) is reported as a content mismatch, not a pass
- Status codes that require a genuine downstream/server failure or a real duplicate-processing race (405, 409, 500, 501, 502, 503, 504) are recorded as **skipped** with an explanation, rather than being silently dropped or reused against the baseline request and reported as a false failure
- SDK and HTTP results are reported independently

## Troubleshooting

**"No code content found"**
- Increase wait times in language switching (line ~448)
- Check if page structure has changed

**Token generation fails**
- Verify `.env` credentials are correct
- Check network connection to sandbox environment

**Page load timeout**
- Page uses multiple fallback strategies
- Partial extraction attempted on timeout

## License

MIT
