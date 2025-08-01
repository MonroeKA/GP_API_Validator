# Global Payments Developer Portal QA Automation

A comprehensive QA automation system designed to systematically audit the Global Payments developer portal, test code snippets against the sandbox environment, and generate detailed discrepancy reports.

## 🎯 Overview

This system performs a complete end-to-end audit of the Global Payments developer portal by:

1. **Crawling & Scraping**: Systematically navigating the entire developer portal to extract all content
2. **Code Extraction**: Identifying and categorizing code snippets across different programming languages
3. **API Testing**: Executing extracted code snippets against the sandbox environment
4. **Analysis & Reporting**: Comparing actual API behavior with documented behavior and generating comprehensive reports

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Internet connection for crawling and API testing

### Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```

### 🔑 API Credentials Setup (Important!)

**Before running tests, configure your Global Payments API credentials for accurate results:**

```bash
# Interactive setup (recommended)
node src/credentials.js setup

# Or check current status
node src/credentials.js check
```

**Why this matters:**
- ✅ **With real credentials**: Tests use your actual API access and return meaningful results
- ❌ **Without credentials**: Tests fail with authentication errors, providing limited insights

**Getting your credentials:**
1. Go to https://developer.globalpay.com/
2. Sign up/login and create an application
3. Copy your App ID and App Key
4. Use sandbox credentials for testing

📖 **Detailed setup guide**: See [CREDENTIALS-SETUP.md](./CREDENTIALS-SETUP.md)

### Running the Full Audit

Execute the complete audit process:

```bash
npm run full-audit
```

This will run all three phases automatically:
- Phase 1: Crawl and scrape the developer portal
- Phase 2: Test extracted code snippets
- Phase 3: Generate comprehensive report

### Running Individual Components

You can also run each component separately:

```bash
# Crawl and scrape only
npm run crawl

# Test snippets only (requires crawl data)
npm run test-snippets

# Generate report only (requires crawl and test data)
node src/report-generator.js
```

## 📊 Generated Reports

After running the audit, you'll find several files:

### Data Files (./data/)
- `latest-crawl-data.json` - Complete crawling results
- `latest-test-results.json` - API testing results  
- `latest-broken-links.json` - Broken links found
- Timestamped versions of all data files

### Reports (./reports/)
- `REPORT.md` - **Main comprehensive QA report**
- Timestamped report copies

## 📋 Report Structure

The main report (`./reports/REPORT.md`) includes:

### A. Executive Summary
- Key metrics and statistics
- Critical issues overview
- Success rate analysis

### B. Snippet Test Results
- Detailed test execution results
- Pass/fail status for each code snippet
- Request/response details
- Error analysis

### C. Documentation Discrepancy Report
- Comparison between documented and actual API behavior
- Evidence of discrepancies
- Impact assessment
- Recommendations for fixes

### D. Broken Links & Errors
- List of inaccessible URLs
- Error details and status codes

### E. Detailed Technical Findings
- API endpoint analysis
- Code snippet language distribution
- Page coverage statistics

### F. Recommendations & Action Items
- Prioritized list of improvements
- Specific actions for developers
- Quality assurance suggestions

## ⚙️ Configuration

The system can be configured by modifying `src/config.js`:

### Key Configuration Options

```javascript
{
    // Crawling limits
    MAX_PAGES: 50,
    
    // Request timeouts
    REQUEST_TIMEOUT: 30000,
    
    // Test credentials (sandbox)
    TEST_CREDENTIALS: {
        username: 'globalpayments',
        password: 'globalpayments',
        // ... other test credentials
    },
    
    // Test card numbers
    TEST_CARDS: {
        visa: '4263970000005262',
        // ... other test cards
    }
}
```

## 🔧 Architecture

### Core Components

1. **GlobalPaymentsCrawler** (`src/crawler.js`)
   - Web crawling using Playwright
   - Content extraction and parsing
   - Link discovery and navigation
   - Data structure generation

2. **SnippetTester** (`src/snippet-tester.js`)
   - Code snippet parsing and analysis
   - API request construction
   - Sandbox environment testing
   - Response validation

3. **ReportGenerator** (`src/report-generator.js`)
   - Data analysis and correlation
   - Discrepancy detection
   - Markdown report generation
   - Recommendation engine

4. **FullAuditOrchestrator** (`src/full-audit.js`)
   - Process coordination
   - Error handling
   - Progress reporting

### Data Flow

```
Developer Portal → Crawler → Raw Data → Tester → Test Results → Reporter → Final Report
```

## 🧪 Testing Approach

### Code Snippet Processing

The system identifies and processes various types of code snippets:

- **cURL commands** - Converted to HTTP requests
- **JSON examples** - Used as request bodies
- **XML/SOAP** - Sent as XML requests
- **Language-specific code** - Analyzed for API patterns

### API Testing Strategy

- All requests directed to sandbox environment
- Test credentials automatically injected
- Multiple authentication methods attempted
- Response validation against documentation
- Error classification and reporting

### Validation Criteria

A test is considered **PASSED** if:
- HTTP status code is 2xx-4xx (not 5xx server errors)
- Response structure matches expected format
- No critical errors in response body

## 📈 Metrics & Analysis

The system tracks and reports on:

- **Coverage Metrics**: Pages crawled, snippets found
- **Quality Metrics**: Test pass/fail rates, error types
- **Accuracy Metrics**: Documentation vs. reality comparison
- **Technical Metrics**: Response times, error rates

## 🔍 Troubleshooting

### Common Issues

1. **No crawl data found**
   - Ensure you run the crawler first: `npm run crawl`
   - Check internet connectivity

2. **Authentication failures**
   - Verify sandbox credentials in `src/config.js`
   - Check Global Payments sandbox status

3. **High failure rates**
   - Review the detailed test results in the report
   - Check if sandbox environment is operational
   - Verify test data configuration

### Debug Mode

Enable detailed logging by setting in `src/config.js`:
```javascript
CRAWLING: {
    HEADLESS_MODE: false, // Shows browser during crawling
}
```

## 🛡️ Security & Privacy

- Uses only public sandbox credentials
- No production data or credentials
- Respects robots.txt and rate limiting
- All testing done against approved sandbox environment

## 📝 Sample Output

After running the full audit, you'll see:

```
🎉 FULL QA AUDIT COMPLETED SUCCESSFULLY
========================================

⏱️  Total Duration: 180 seconds
📂 Generated Files:
   📄 ./data/latest-crawl-data.json - Scraped portal data
   🧪 ./data/latest-test-results.json - API test results  
   🔗 ./data/latest-broken-links.json - Broken links found
   📊 ./reports/REPORT.md - Comprehensive QA report

🔍 Next Steps:
   1. Review the main report: ./reports/REPORT.md
   2. Address any critical issues identified
   3. Fix broken links and failed code snippets
   4. Consider implementing automated testing pipeline
```

## 🤝 Contributing

To extend or modify the system:

1. **Add new test types**: Extend `SnippetTester` class
2. **Improve crawling**: Modify `GlobalPaymentsCrawler` selectors
3. **Enhance reporting**: Add new sections to `ReportGenerator`
4. **Configure for other APIs**: Update `config.js` settings

## 📄 License

This QA automation system is provided as-is for educational and quality assurance purposes.
