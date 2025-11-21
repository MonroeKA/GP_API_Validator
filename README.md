# Global Payments API Validator

Automated tool to extract and test API endpoints from Global Payments developer documentation.

<img width="1232" height="848" alt="image" src="https://github.com/user-attachments/assets/e1785776-3535-41d6-a095-08149e6c04fd" />

## Features

- **Automated Extraction**: Scrapes API documentation using Playwright
  - Extracts code snippets in multiple languages (JSON, cURL)
  - Captures request structure (URL, headers, body)
  - Extracts documented HTTP status codes
  - Handles multi-tab JSON structure (URL & QUERY, HEADERS, BODY)
  - Single-block extraction for cURL commands

- **Live API Testing**: Tests extracted endpoints against the actual API
  - Generates fresh OAuth 2.0 tokens
  - Tests multiple HTTP status code scenarios
  - Validates response structure and format
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

3. Install Playwright browsers:
```bash
npx playwright install firefox
```

4. Create `.env` file from the example:
```bash
cp .env.example .env
```

5. Edit `.env` and add your Global Payments API credentials:
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

3. Enter a Global Payments API documentation URL and click:
   - **Extract Only** - Just scrape the documentation
   - **Extract & Test** - Scrape and run live API tests

## Example URLs

- `https://developer.globalpayments.com/api/accounts#/Retrieve%20a%20List%20of%20Accounts/retrieveAListOfAccounts`
- `https://developer.globalpayments.com/api/links#/Create%20a%20link/post-links`

## Architecture

### Backend (`server.js`)
- Express server on port 3000
- Playwright-based web scraper (Firefox headless)
- OAuth 2.0 token generation with SHA512 secrets
- Live API testing with scenario coverage

### Frontend (`frontend.html`)
- Interactive dashboard with tabbed interface
- Syntax highlighting for code snippets
- Real-time extraction status
- Historical results browser

### Extraction Process
1. Navigate to documentation page
2. Detect available languages (JSON, cURL)
3. For each language:
   - Switch language if needed (2s wait for UI update)
   - JSON: Extract from 3 tabs (URL & QUERY, HEADERS, BODY)
   - cURL: Extract single complete command
4. Extract documented HTTP status codes
5. Parse endpoint metadata (method, URL, headers)

## API Endpoints

- `POST /api/extract` - Extract and optionally test an API endpoint
  ```json
  {
    "url": "https://developer.globalpayments.com/api/...",
    "runLiveTest": true
  }
  ```

- `GET /api/health` - Health check
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
