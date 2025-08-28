# Global Payments API Testing Suite

A comprehensive API testing and scraping system designed to test Global Payments API endpoints with dual-mode operation: single endpoint testing or full-site navigation crawling with detailed interactive dashboards.

## 🎯 Overview

This enhanced system provides flexible API testing capabilities:

1. **Dual-Mode Scraper**: Choose between single endpoint testing or full-site navigation crawling
2. **Interactive Dashboard**: Detailed test results with expandable request/response information
3. **Response Time Tracking**: Monitor API performance with detailed timing metrics  
4. **Multi-Site Testing**: Test multiple endpoints simultaneously with organized results
5. **Enhanced Reporting**: Comprehensive test data with status codes, headers, and full responses

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- npm package manager
- Internet connection for API testing and scraping

### Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```

### Available Commands

| Command | Description |
|---------|-------------|
| `npm start` | Launch the main API scraper with mode selection |
| `npm run dashboard` | Create enhanced dashboard from latest results |
| `npm run view` | Open the interactive results dashboard |
| `npm run clean` | Clean up temporary files and old results |

### 🔑 API Testing Setup

**The system provides flexible credential management:**

**Option 1: Interactive Setup (Recommended)**
```bash
npm start
```
The system will automatically:
1. Check for existing credentials in `config/credentials.json`
2. Prompt you to enter credentials if none are found
3. Offer to save credentials for future use
4. Guide you through mode selection and testing

**Option 2: Manual Configuration**
Create or edit `config/credentials.json`:
```json
{
  "globalPayments": {
    "appId": "your-app-id",
    "appKey": "your-app-key", 
    "environment": "sandbox",
    "baseUrl": "https://apis.sandbox.globalpay.com",
    "version": "2021-03-22"
  }
}
```

**Option 3: Default Mode**
If no credentials are provided, the system uses default sandbox credentials with limited functionality.

**Supported Testing Modes:**
- ✅ **Single Endpoint**: Test a specific API endpoint with detailed analysis
- ✅ **Full-Site Crawling**: Navigate and test all discoverable endpoints automatically
- ✅ **Multi-Site Testing**: Test multiple endpoints with organized tabbed results

### Running the Enhanced API Scraper

Execute the main scraping and testing system:

```bash
npm start
```

This will launch the interactive system that guides you through:
- **Mode Selection**: Choose between single endpoint or full-site crawling
- **Target Configuration**: Enter API endpoint or let the system discover endpoints
- **Credential Setup**: Configure authentication for comprehensive testing  
- **Automated Testing**: Execute tests with detailed response capture
- **Dashboard Generation**: Automatically create interactive results dashboard

### Running Individual Components

You can also run specific components:

```bash
# Generate enhanced dashboard from existing results
npm run dashboard

# Open the interactive dashboard in your browser
npm run view

# Clean up old results and temporary files
npm run clean
```

## 📊 Enhanced Dashboard Features

After running tests, you'll have access to an interactive dashboard with:

### Key Features
- **Expandable Test Cards**: Click any test result to view detailed request/response information
- **Response Time Tracking**: See exact timing metrics for each API call
- **Status Code Analysis**: Visual indicators for success/failure with detailed HTTP status information
- **Request/Response Details**: Full headers, body content, and response data for debugging
- **Multi-Site Organization**: Tabbed interface for testing multiple endpoints simultaneously

### Dashboard Files
- `results-dashboard-autoload.html` - Interactive dashboard that auto-loads latest results
- `results/` - Directory containing JSON test results and historical data
- Test results automatically organized by timestamp for easy tracking

### Dashboard Navigation
- **Single Endpoint Tab**: Detailed results for individual endpoint testing
- **Multi-Site Tab**: Organized results when testing multiple endpoints
- **Expandable Details**: Click "Show Details" to see full request/response information
- **Response Times**: Millisecond-precision timing for performance analysis

## 📋 Test Results Structure

The enhanced testing system generates comprehensive data:

### A. Individual Test Results
- **Request Details**: Complete HTTP request information including headers, method, and body
- **Response Analysis**: Full response data with status codes, headers, and body content
- **Performance Metrics**: Response time tracking with millisecond precision
- **Error Handling**: Detailed error information and debugging context

### B. Multi-Site Test Results  
- **Organized by Site**: Results grouped by target domain or endpoint category
- **Batch Processing**: Multiple endpoints tested simultaneously with consolidated results
- **Comparative Analysis**: Easy comparison across different API endpoints
- **Success Rate Tracking**: Overall performance metrics across all tested endpoints

### C. Enhanced Dashboard Display
- **Interactive Elements**: Expandable test cards with detailed information
- **Visual Indicators**: Color-coded status indicators for quick assessment
- **Search and Filter**: Easy navigation through large result sets
- **Export Capabilities**: JSON data available for further analysis

### D. Historical Data Tracking
- **Timestamped Results**: All test runs preserved with timestamps
- **Performance Trends**: Track API performance over time
- **Regression Detection**: Compare current results with historical data
- **Data Persistence**: Results saved in organized directory structure

## ⚙️ Configuration

The system can be configured within the interactive scraper:

### Key Configuration Options

```javascript
// Mode Selection
SCRAPING_MODES: {
    SINGLE_ENDPOINT: "Test a specific API endpoint",
    FULL_SITE_CRAWLING: "Navigate and test all discoverable endpoints"
}

// Global Payments Integration
GLOBAL_PAYMENTS: {
    BASE_URL: "https://developer.globalpay.com",
    SANDBOX_ENDPOINTS: true,
    NAVIGATION_SELECTORS: {
        mainNav: '.nav-primary',
        subNav: '.nav-secondary', 
        endpoints: '.endpoint-link'
    }
}

// Testing Configuration
TESTING: {
    REQUEST_TIMEOUT: 30000,
    MAX_CONCURRENT_REQUESTS: 5,
    RETRY_ATTEMPTS: 3,
    DETAILED_LOGGING: true
}

// Dashboard Configuration  
DASHBOARD: {
    AUTO_OPEN: true,
    EXPANDABLE_DETAILS: true,
    RESPONSE_TIME_PRECISION: 'ms',
    THEME: 'modern'
}
```
```

## 🔧 Architecture

### Core Components

1. **Enhanced API Scraper** (`api-scraper.js`)
   - Dual-mode operation (single/full-site)
   - Navigation discovery using Playwright
   - Global Payments integration
   - Interactive endpoint selection
   - Comprehensive response capture

2. **Enhanced Dashboard Generator** (`create-enhanced-dashboard.js`)
   - Interactive HTML dashboard creation
   - Expandable test result cards
   - Response time visualization
   - Request/response detail display
   - Multi-site result organization

3. **Interactive Dashboard** (`results-dashboard-autoload.html`)
   - Auto-loading latest test results
   - Expandable test details
   - Response time metrics
   - Tabbed multi-site interface
   - Modern responsive design

### Data Flow

```
User Input → Mode Selection → Endpoint Discovery → API Testing → Response Capture → Dashboard Generation → Interactive Display
```

### Enhanced Features

- **Dual-Mode Architecture**: Seamlessly switch between single endpoint and full-site crawling
- **Real-Time Dashboard**: Automatically generated and updated interactive results display
- **Performance Tracking**: Detailed response time analysis with millisecond precision
- **Comprehensive Logging**: Full request/response capture for debugging and analysis

## 🧪 Testing Approach

### Dual-Mode Testing Strategy

**Single Endpoint Mode:**
- Direct API endpoint testing with comprehensive analysis
- Detailed request/response capture
- Performance timing with millisecond precision
- Authentication handling and error analysis

**Full-Site Crawling Mode:**
- Automatic navigation discovery using Playwright browser automation
- Global Payments developer portal integration
- Batch processing of discovered endpoints
- Comprehensive site-wide API testing

### API Testing Methodology

- **Smart Navigation**: Intelligently discovers API endpoints from documentation
- **Authentication Integration**: Automatically handles Global Payments API authentication
- **Request Construction**: Builds appropriate requests based on discovered endpoint patterns
- **Response Analysis**: Comprehensive response validation and error handling
- **Performance Monitoring**: Tracks response times and API performance metrics

### Enhanced Validation Criteria

A test provides comprehensive results including:
- **Full Request Details**: Headers, method, body, and authentication
- **Complete Response Data**: Status codes, headers, body content, and timing
- **Error Context**: Detailed error information for debugging
- **Performance Metrics**: Response time analysis for performance monitoring

## 📈 Metrics & Analysis

The enhanced system tracks and reports comprehensive metrics:

- **Test Coverage**: Endpoints discovered and tested across single/multi-site modes
- **Performance Analysis**: Response time distributions and API performance trends  
- **Success Rates**: HTTP status code analysis with detailed error categorization
- **Request/Response Data**: Complete capture of all API interactions for analysis
- **Navigation Efficiency**: Crawling effectiveness and endpoint discovery rates

### Dashboard Analytics

- **Interactive Visualization**: Expandable test cards with detailed metrics
- **Response Time Tracking**: Millisecond-precision performance monitoring
- **Status Code Distribution**: Visual breakdown of success/error rates
- **Historical Comparison**: Track API performance changes over time
- **Detailed Debugging**: Full request/response data for troubleshooting

## 🔍 Troubleshooting

### Common Issues

1. **No test results generated**
   - Ensure you've run the scraper: `npm start`
   - Check internet connectivity for API testing
   - Verify target endpoint is accessible

2. **Dashboard not loading**
   - Run dashboard generator: `npm run dashboard`
   - Check that results files exist in the `/results` directory
   - Try opening dashboard manually: `npm run view`

3. **Authentication issues**
   - Configure API credentials during scraper setup
   - Verify Global Payments API access
   - Check sandbox environment availability

4. **Navigation discovery problems**
   - Ensure target site structure matches expected patterns
   - Check browser automation permissions
   - Verify Playwright dependencies are installed

### Debug Mode

Enable detailed logging during testing:
- Select verbose output when prompted during scraper execution
- Check browser console for navigation issues
- Review generated JSON files for detailed error information

### Performance Issues

If testing is slow or failing:
- Reduce concurrent request limits
- Check network connectivity and API response times
- Verify target endpoints are responding correctly

## 🛡️ Security & Privacy

- **Sandbox Testing**: All API testing directed to appropriate sandbox environments
- **Credential Management**: Interactive setup with secure credential handling
- **Rate Limiting**: Respects API rate limits and implements appropriate delays
- **Data Privacy**: Test data and results stored locally, no external data transmission
- **Browser Automation**: Uses Playwright with appropriate security settings

## 📝 Sample Output

After running the enhanced API scraper, you'll see:

```
🚀 ENHANCED API SCRAPER
========================

✨ Mode Selection:
   1. Single Endpoint Testing - Test a specific API endpoint
   2. Full-Site Crawling - Navigate and test discovered endpoints
   
🎯 Selected Mode: Full-Site Crawling

🔍 Navigation Discovery:
   📂 Discovered 15 API endpoints from Global Payments developer portal
   🌐 Processing batch requests with performance tracking
   
📊 Test Results Generated:
   ✅ 12/15 endpoints tested successfully
   ⏱️  Average response time: 245ms
   📄 results/api-test-results-2024-01-15-14-30.json created
   
🎨 Enhanced Dashboard:
   📊 results-dashboard-autoload.html generated
   🚀 Opening interactive dashboard...
```

## 🤝 Contributing

To extend or modify the enhanced system:

1. **Add new testing modes**: Extend mode selection in `api-scraper.js`
2. **Enhance navigation discovery**: Modify Playwright selectors for different sites
3. **Improve dashboard features**: Add new interactive elements to `create-enhanced-dashboard.js`
4. **Add new API integrations**: Configure additional API testing capabilities
5. **Extend performance metrics**: Add new tracking and analysis features

### Development Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm start

# Generate dashboard for testing
npm run dashboard

# Clean development files
npm run clean
```

## 📄 Documentation

For detailed information about specific components:
- [Dashboard README](./DASHBOARD-README.md) - Comprehensive dashboard documentation
- [Credentials Setup](./CREDENTIALS-SETUP.md) - API credential configuration guide

## 📄 License

This enhanced API testing suite is provided as-is for development and testing purposes.
