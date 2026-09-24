// Shared extraction/testing/verification engine used by both server.js (dashboard)
// and cli.js (pipeline/CI entrypoint). Kept side-effect free at import time so it
// can be safely used from a batch CLI without booting an Express server.
import { firefox } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

// Repo root, one level up from lib/, so sdk-verifiers/ resolves correctly
// regardless of which entrypoint (server.js or cli.js) imports this module.
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);

// Resolves GP API credentials/config from the environment. Real environment
// variables (e.g. secrets injected by a CI/CD pipeline) always win; a local
// .env file - if present - only fills in values that aren't already set, so
// this works unchanged for both local development and CI, without ever
// requiring credentials to be written to disk in a pipeline workspace.
async function loadEnvVars() {
    const envVars = { ...process.env };

    try {
        const envPath = path.join(process.cwd(), '.env');
        const envData = await fs.readFile(envPath, 'utf8');
        envData.split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, value] = line.split('=');
                if (key && value && !(key.trim() in envVars)) {
                    envVars[key.trim()] = value.trim().split('#')[0].trim();
                }
            }
        });
    } catch (error) {
        // No .env file (e.g. a CI pipeline supplying real env vars) - that's fine.
    }

    return envVars;
}

function validateSdkConfiguration(envVars) {
    const errors = [];
    const isPlaceholder = value => !value || /^(your_|replace|example)|_here$/i.test(value);
    const environment = envVars.GP_API_ENVIRONMENT?.toLowerCase();

    if (isPlaceholder(envVars.GP_API_APP_ID)) {
        errors.push('GP_API_APP_ID must contain a real sandbox app ID');
    }
    if (isPlaceholder(envVars.GP_API_APP_KEY)) {
        errors.push('GP_API_APP_KEY must contain a real sandbox app key');
    }
    if (!['sandbox', 'test'].includes(environment)) {
        errors.push('GP_API_ENVIRONMENT must be sandbox or test');
    }

    return errors;
}

// Generate fresh access token
async function generateFreshToken() {
    try {
        console.log('🔑 Generating fresh access token...');

        const envVars = await loadEnvVars();

        const configurationErrors = validateSdkConfiguration(envVars);
        if (configurationErrors.length > 0) {
            throw new Error(configurationErrors.join('; '));
        }
        
        // Use OAuth 2.0 to get access token from Global Payments
        const tokenEndpoint = 'https://apis.sandbox.globalpay.com/ucp/accesstoken';
        
        // Generate proper secret as per Global Payments documentation
        // Secret = SHA512(nonce + appKey)
        const nonce = Date.now().toString() + Math.random().toString(36).substring(2);
        const secret = crypto.createHash('sha512').update(nonce + envVars.GP_API_APP_KEY).digest('hex');
        
        console.log('   📤 Requesting token from Global Payments...');
        
        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-GP-Version': '2021-03-22'
            },
            body: JSON.stringify({
                app_id: envVars.GP_API_APP_ID,
                nonce: nonce,
                secret: secret,
                grant_type: 'client_credentials'
            })
        });
        
        const responseText = await response.text();
        
        if (!response.ok) {
            console.error(`   ❌ Token request failed: ${response.status}`);
            console.error(`   Response: ${responseText}`);
            throw new Error(`Token request failed: ${response.status} - ${responseText}`);
        }
        
        const tokenResponse = JSON.parse(responseText);
        
        // Create token data with scope
        const tokenData = {
            token: tokenResponse.token,
            type: tokenResponse.type || 'Bearer',
            app_id: envVars.GP_API_APP_ID,
            seconds_to_expire: tokenResponse.seconds_to_expire,
            email: tokenResponse.email,
            scope: tokenResponse.scope
        };
        
        // Save to file
        const tokenFile = path.join(process.cwd(), 'gp-access-token.json');
        await fs.writeFile(tokenFile, JSON.stringify(tokenData, null, 2));
        
        console.log(`✅ Fresh token generated (expires in ${tokenResponse.seconds_to_expire}s)`);
        return tokenData;
        
    } catch (error) {
        console.error('❌ Error generating token:', error.message);
        throw error;
    }
}

export async function extractFromUrl(testUrl) {
    const browser = await firefox.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        timeout: 120000 // 120 second browser timeout
    });
    
    const page = await browser.newPage();
    
    // Set global timeouts to prevent hanging
    page.setDefaultTimeout(30000); // 30 seconds for individual operations
    page.setDefaultNavigationTimeout(60000); // 60 seconds for page navigation
    
    let extractedData = {};
    let extractionLog = [];
    
    // Helper function to log to both console and extraction log
    const logMessage = (message) => {
        console.log(message);
        extractionLog.push(message);
    };
    
    try {
        console.log('   Attempting to load page...');

        try {
            await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (navigationError) {
            console.log(`   Navigation did not fully settle: ${navigationError.message}`);
        }

        await page.locator('main, pre, .api-explorer__try-it').first().waitFor({ state: 'attached', timeout: 30000 });
        console.log('   Page loaded successfully');
        extractedData = await extractFromEndpoint(page);
        
    } catch (error) {
        console.error(`Extraction error: ${error.message}`);
        
        // If page failed to load, try to extract whatever we can
        if (error.name === 'TimeoutError') {
            console.log('   Attempting extraction from partially loaded page...');
            try {
                extractedData = await extractFromEndpoint(page);
                if (extractedData.method || extractedData.url) {
                    console.log('   Partial extraction successful');
                } else {
                    throw new Error('Page failed to load and no data could be extracted');
                }
            } catch (partialError) {
                throw new Error(`Page load timeout (30s exceeded) and partial extraction failed: ${partialError.message}`);
            }
        } else {
            throw error;
        }
    } finally {
        await browser.close();
    }
    
    // Include extraction log in the returned data
    extractedData.extractionLog = extractionLog.join('\n');
    
    return extractedData;
}

async function extractFromEndpoint(page) {
    const requestDetails = {
        method: null,
        url: null,
        headers: {},
        body: null,
        responseExamples: {},
        documentedStatusCodes: [],
        documentedStatusCodeDescriptions: {},
        documentedErrorCodesByStatus: {},
        codeSnippets: {},
        examples: [],
        extractedDocumentation: {}
    };
    
    let availableLanguages = [];
    
    try {
        // Wait for page to load
        try {
            await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
        } catch (loadError) {
            console.log('   ⚠️ Load state timeout, continuing anyway...');
        }
        
        await page.waitForTimeout(2000);
        
        // Dismiss cookie consent banner if present (blocks clicks)
        try {
            const cookieBanner = await page.locator('#onetrust-consent-sdk').first();
            const isVisible = await cookieBanner.isVisible().catch(() => false);
            if (isVisible) {
                // Try to find and click accept button
                const acceptButton = await page.locator('button#onetrust-accept-btn-handler').first();
                const acceptVisible = await acceptButton.isVisible().catch(() => false);
                if (acceptVisible) {
                    await acceptButton.click();
                    console.log('   ✓ Dismissed cookie consent banner');
                    await page.waitForTimeout(1000);
                }
            }
        } catch (e) {
            // Cookie banner not present or already dismissed
        }
        
        console.log('   🔄 Starting comprehensive code extraction...');
        
        // ===== TASK 2: HANDLE ALL DROPDOWNS & LANGUAGES =====
        console.log('\n   📋 TASK 2: Detecting language options and examples...');
        
        // Step 1: Find language buttons using the correct selector
        // Language button: class="mx-0 mt-1 request-switcher border border-solid border-[#ffffff4d] rounded-[6px] w-full flex justify-between items-center py-1.5 px-3"
        const allButtons = await page.locator('button').all();
        let languageDropdown = null;
        let languageDropdownText = '';
        
        console.log(`      🔍 Scanning ${allButtons.length} buttons for language dropdown...`);
        
        for (const btn of allButtons) {
            try {
                const btnText = await btn.textContent();
                const hasRequestSwitcherClass = await btn.evaluate((el) => el.classList.contains('request-switcher'));
                
                // Match language buttons: have "request-switcher" class AND text is a language name
                if (hasRequestSwitcherClass && btnText && btnText.trim().match(/^(JSON|CURL|cURL|Python|JavaScript|Java|PHP|Ruby|Go|Node)$/i)) {
                    languageDropdown = btn;
                    languageDropdownText = btnText.trim();
                    console.log(`      ✓ Found language dropdown: "${languageDropdownText}"`);
                    break;
                }
            } catch (e) {
                // Continue
            }
        }
        
        // Get list of available languages
        if (languageDropdown) {
            try {
                await languageDropdown.click();
                await page.waitForTimeout(800);
                
                const langOptions = await page.locator('a[role="menuitem"]').allTextContents();
                availableLanguages = langOptions
                    .map(text => text.trim().toLowerCase())
                    .filter(text => text && text.length > 0 && text.length < 20);
                
                console.log(`      ✓ Available languages: ${availableLanguages.join(', ')}`);
                
                // Close dropdown
                await languageDropdown.click();
                await page.waitForTimeout(500);
            } catch (e) {
                console.log(`      ⚠️ Could not read language options: ${e.message}`);
            }
        }
        
        // Step 2: Find example variations
        console.log(`\n   📋 Detecting example variations...`);
        let exampleDropdown = null;
        let exampleNames = [];
        
        console.log(`      🔍 Scanning ${allButtons.length} buttons for example dropdown...`);
        
        for (const btn of allButtons) {
            try {
                const btnText = await btn.textContent();
                const hasMenu = await btn.getAttribute('aria-haspopup');
                const classes = await btn.getAttribute('class');
                
                // Debug: log buttons with aria-haspopup
                if (hasMenu === 'menu') {
                    console.log(`      🔍 Button with menu: "${btnText?.trim()}" | Classes: ${classes?.substring(0, 80)}...`);
                }
                
                // Match the specific example dropdown button by its characteristics:
                // - Has aria-haspopup="menu"
                // - Has border-n-grey-76 class (distinguishes from language/version dropdowns)
                // - Is bp5-minimal with rounded styling
                // - Does NOT contain "Switch To" or "Viewing" (those are API version switchers)
                const isExampleDropdown = hasMenu === 'menu' && 
                                         classes?.includes('border-n-grey-76') &&
                                         btnText && 
                                         !btnText.includes('Switch To') &&
                                         !btnText.includes('Viewing');
                
                if (isExampleDropdown) {
                    exampleDropdown = btn;
                    console.log(`      ✓ Found example dropdown: "${btnText?.trim()}"`);
                    
                    // Click to get examples
                    await btn.click();
                    await page.waitForTimeout(1000);
                    
                    // Example menu items are in <ul class="api-explorer__example-list bp5-menu">
                    // Each item is an <a role="menuitem"> with text in a <div>
                    const exampleMenu = await page.locator('ul.api-explorer__example-list').first();
                    const exampleItems = await exampleMenu.locator('a[role="menuitem"]').all();
                    
                    console.log(`      🔍 Found ${exampleItems.length} items in api-explorer__example-list`);
                    
                    for (const item of exampleItems) {
                        try {
                            const itemText = await item.textContent();
                            if (itemText && itemText.trim()) {
                                exampleNames.push(itemText.trim());
                            }
                        } catch (e) {
                            // Skip
                        }
                    }
                    
                    console.log(`      ✓ Found ${exampleNames.length} examples: ${exampleNames.slice(0, 5).join(', ')}${exampleNames.length > 5 ? '...' : ''}`);
                    
                    // Close dropdown by clicking button again
                    await btn.click();
                    await page.waitForTimeout(500);
                    break;
                }
            } catch (e) {
                // Continue
            }
        }
        
        // Step 3: Find tab structure
        console.log(`\n   📋 Detecting tab structure...`);
        
        // Tabs are simple buttons with text: "URL & QUERY", "HEADERS", "BODY"
        // They appear at the top of the request/response section
        let tabNames = [];
        
        const allTabButtons = await page.locator('button').all();
        
        for (const tab of allTabButtons) {
            try {
                const tabText = await tab.textContent();
                if (tabText && tabText.trim()) {
                    const cleanText = tabText.trim();
                    // Look for exact tab names
                    if (cleanText === 'URL & QUERY' || cleanText === 'HEADERS' || cleanText === 'BODY') {
                        tabNames.push({ element: tab, name: cleanText });
                        console.log(`      ✓ Found tab: "${cleanText}"`);
                    }
                }
            } catch (e) {
                // Skip
            }
        }
        
        if (tabNames.length > 0) {
            console.log(`      ✓ Found ${tabNames.length} tabs: ${tabNames.map(t => t.name).join(', ')}`);
        } else {
            console.log(`      ⚠️ No tabs detected - checking for alternative tab structure...`);
            
            // Fallback: look for any BP5 buttons that might be tabs (excluding status code buttons)
            for (const tab of allTabButtons) {
                try {
                    const tabText = await tab.textContent();
                    const hasStatusCode = tabText?.match(/^\d{3}\s+/);
                    if (tabText && tabText.trim() && !hasStatusCode && !tabText.includes('Example')) {
                        tabNames.push({ element: tab, name: tabText.trim() });
                    }
                } catch (e) {
                    // Skip
                }
            }
        }
        
        // Step 4: Extract code for each language/example/tab combination
        console.log(`\n   📋 Extracting code snippets for each variation...`);
        let snippetCount = 0;
        
        // Handle case with no examples (single example)
        const examplesArray = exampleNames.length > 0 ? exampleNames : ['default'];
        
        console.log(`      ℹ️  Processing ${examplesArray.length} example(s)...`);
        
        for (let exampleIndex = 0; exampleIndex < examplesArray.length; exampleIndex++) {
            const exampleName = examplesArray[exampleIndex];
            
            if (exampleName !== 'default') {
                console.log(`\n   📂 Example ${exampleIndex + 1}/${examplesArray.length}: "${exampleName}"`);
                
                try {
                    // Click example dropdown and select this example
                    if (exampleDropdown) {
                        console.log(`      🔄 Switching to example: "${exampleName}"...`);
                        
                        // Dismiss cookie banner again if it reappeared
                        try {
                            const cookieButton = await page.locator('button#onetrust-accept-btn-handler').first();
                            const isVisible = await cookieButton.isVisible({ timeout: 500 }).catch(() => false);
                            if (isVisible) {
                                await cookieButton.click();
                                await page.waitForTimeout(500);
                                console.log(`      ✓ Dismissed cookie banner`);
                            }
                        } catch (e) {
                            // No cookie banner
                        }
                        
                        await exampleDropdown.click();
                        await page.waitForTimeout(1000);
                        
                        // Find the example in the api-explorer__example-list menu
                        const exampleMenu = await page.locator('ul.api-explorer__example-list').first();
                        const exampleItems = await exampleMenu.locator('a[role="menuitem"]').all();
                        
                        let foundExample = false;
                        for (const item of exampleItems) {
                            const itemText = await item.textContent();
                            if (itemText?.trim() === exampleName) {
                                // Force click to bypass any overlays
                                await item.click({ force: true });
                                await page.waitForTimeout(2000); // Wait longer for example to fully load
                                foundExample = true;
                                console.log(`      ✓ Switched to example: "${exampleName}"`);
                                break;
                            }
                        }
                        
                        if (!foundExample) {
                            console.log(`      ⚠️  Could not find example "${exampleName}" in dropdown, skipping`);
                            continue;
                        }
                    }
                } catch (e) {
                    console.log(`      ⚠️ Error selecting example "${exampleName}": ${e.message}`);
                    continue;
                }
            } else {
                console.log(`\n   📂 Using default example (no switching needed)`);
            }
            
            // IMPORTANT: Extract tabs for EACH language separately
            // Must process all tabs for one language BEFORE switching to the next language
            for (const lang of availableLanguages) {
                try {
                    console.log(`      📝 Extracting for language: ${lang}`);
                    
                    // Log current language shown in dropdown
                    const currentLangDisplay = await languageDropdown?.evaluate(el => el.textContent?.trim());
                    console.log(`         ℹ️  Current dropdown shows: "${currentLangDisplay}", target language: "${lang}"`);
                    
                    // For languages other than the default (JSON), switch to it first
                    if (lang !== availableLanguages[0] && languageDropdown) {
                        try {
                            console.log(`         🔄 Switching to ${lang} language...`);
                            await languageDropdown.click();
                            await page.waitForTimeout(1000);
                            
                            const langOptions = await page.locator('a[role="menuitem"]').all();
                            let found = false;
                            for (const option of langOptions) {
                                const optText = await option.textContent();
                                // Case-insensitive match (handles "cURL" vs "curl", "JSON" vs "json", etc.)
                                if (optText?.trim().toLowerCase() === lang.toLowerCase()) {
                                    try {
                                        await option.click({ force: true });
                                        
                                        // Wait for the UI to update (increased from 1.2s to 2s based on successful test)
                                        await page.waitForTimeout(2000);
                                        
                                        found = true;
                                        console.log(`         ✓ Successfully switched to ${lang}`);
                                        break;
                                    } catch (clickErr) {
                                        console.log(`         ⚠️ Click failed, trying keyboard...`);
                                        try {
                                            await option.focus();
                                            await page.keyboard.press('Enter');
                                            await page.waitForTimeout(1200);
                                            found = true;
                                            console.log(`         ✓ Successfully switched to ${lang} via keyboard`);
                                            break;
                                        } catch (e) {
                                            // Continue to next
                                        }
                                    }
                                }
                            }
                            
                            if (!found) {
                                console.log(`      ⚠️ Could not switch to ${lang} language, skipping`);
                                continue;
                            }
                        } catch (switchErr) {
                            console.log(`      ⚠️ Error switching to ${lang}: ${switchErr.message}`);
                            continue;
                        }
                    } else {
                        console.log(`         ℹ️  Using default ${lang} (no switch needed)`);
                    }
                    
                    // CRITICAL: Different languages have different structures
                    // JSON: Has multi-tab interface (URL & QUERY, HEADERS, BODY tabs) in .api-explorer__try-it__json container
                    // CURL: Single code block in .api-explorer__try-it__curl container - NO TABS
                    // The tab buttons you see are part of JSON's structure and should NOT be used for CURL
                    
                    let tabsForThisLanguage = [];
                    
                    // Check if this language actually uses tabs by checking the active container
                    if (lang === 'json') {
                        // JSON uses tabs - find them within the JSON container
                        const langTabButtons = await page.locator('button').all();
                        
                        for (const tab of langTabButtons) {
                            try {
                                const tabText = await tab.textContent();
                                if (tabText && tabText.trim()) {
                                    const cleanText = tabText.trim();
                                    if (cleanText === 'URL & QUERY' || cleanText === 'HEADERS' || cleanText === 'BODY') {
                                        tabsForThisLanguage.push({ element: tab, name: cleanText });
                                    }
                                }
                            } catch (e) {
                                // Skip
                            }
                        }
                        
                        // Set container for JSON tabs
                        for (const tab of tabsForThisLanguage) {
                            tab.containerClass = '.api-explorer__try-it__json';
                            tab.isSingleBlock = false;
                        }
                    } else {
                        // For all other languages (CURL, etc), treat as single block - NO TABS
                        console.log(`         ℹ️  ${lang} is a single-block language (no tabs)`);
                        
                        tabsForThisLanguage = [{ 
                            element: null, 
                            name: lang.toUpperCase(), 
                            containerClass: null,
                            isSingleBlock: true 
                        }];
                    }
                    
                    // NOW extract all tabs for THIS language
                    // All tab extraction happens while the correct language is active
                    const tabsToExtract = tabsForThisLanguage;
                    
                    console.log(`         ℹ️  Current language: ${lang}, Ready to extract ${tabsToExtract.length} item(s)`);
                    
                    if (tabsToExtract.length > 0) {
                        // Extract from all available tabs - must click each tab to render client-side content
                        for (const tabInfo of tabsToExtract) {
                            try {
                                // If element exists, click it; if null, it's a single code block language (no tab switching needed)
                                if (tabInfo.element) {
                                    console.log(`         📑 Clicking tab: "${tabInfo.name}" for language ${lang}`);
                                    await tabInfo.element.click();
                                    await page.waitForTimeout(1500); // Wait longer for content to render
                                } else {
                                    console.log(`         📑 No tabs for ${lang} - extracting single code block`);
                                    await page.waitForTimeout(1000);
                                }
                                
                                // DEBUG: Log what code blocks we find before extracting
                                const blockCount = await page.evaluate(() => {
                                    const codes = document.querySelectorAll('code, pre');
                                    return codes.length;
                                });
                                console.log(`         ℹ️  Found ${blockCount} code blocks on page`);
                                
                                // Extract code using the exact HTML structure from the documentation
                                const codeText = await page.evaluate(({ languageCode, tabName, isSingleBlock }) => {
                                    if (isSingleBlock) {
                                        // CURL: Extract from .api-explorer__try-it__curl.active
                                        const curlContainer = document.querySelector('.api-explorer__try-it__curl');
                                        if (!curlContainer) {
                                            console.log('[DEBUG] CURL container not found');
                                            return null;
                                        }
                                        
                                        const codeElement = curlContainer.querySelector('code');
                                        if (!codeElement) {
                                            console.log('[DEBUG] CURL code element not found');
                                            return null;
                                        }
                                        
                                        const text = codeElement.textContent.trim();
                                        console.log(`[DEBUG] Extracted CURL: ${text.substring(0, 50)}...`);
                                        return text;
                                        
                                    } else {
                                        // JSON: Extract from .api-explorer__try-it__json .api-explorer__try-it__json__[url|headers|body]
                                        const jsonContainer = document.querySelector('.api-explorer__try-it__json');
                                        if (!jsonContainer) {
                                            console.log('[DEBUG] JSON container not found');
                                            return null;
                                        }
                                        
                                        // Map tab names to their specific selectors
                                        const tabSelectors = {
                                            'URL & QUERY': '.api-explorer__try-it__json__url',
                                            'HEADERS': '.api-explorer__try-it__json__headers',
                                            'BODY': '.api-explorer__try-it__json__body'
                                        };
                                        
                                        const selector = tabSelectors[tabName];
                                        if (!selector) {
                                            console.log(`[DEBUG] Unknown tab: ${tabName}`);
                                            return null;
                                        }
                                        
                                        const tabContainer = jsonContainer.querySelector(selector);
                                        if (!tabContainer) {
                                            console.log(`[DEBUG] Tab container ${selector} not found`);
                                            return null;
                                        }
                                        
                                        const codeElement = tabContainer.querySelector('code');
                                        if (!codeElement) {
                                            console.log(`[DEBUG] Code element not found in ${selector}`);
                                            return null;
                                        }
                                        
                                        const text = codeElement.textContent.trim();
                                        console.log(`[DEBUG] Extracted ${tabName}: ${text.substring(0, 50)}... (length: ${text.length})`);
                                        return text;
                                    }
                                }, { languageCode: lang, tabName: tabInfo.name, isSingleBlock: tabInfo.isSingleBlock });
                                
                                if (!codeText || codeText.length === 0) {
                                    console.log(`         ⊘ No code content found in ${tabInfo.name} tab for ${lang}`);
                                    continue;
                                }
                                
                                console.log(`         ✓ Extracted content from ${tabInfo.name} - ${codeText.substring(0, 40)}...`);
                                
                                // Create unique key for this language+tab combination
                                // For single-block languages like CURL, use just the language as the key (no subtabs)
                                let key, label;
                                
                                if (tabInfo.isSingleBlock) {
                                    // Single block - just use language name
                                    const exampleSuffix = exampleName !== 'default' ? `_${exampleName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}` : '';
                                    key = `${lang}${exampleSuffix}`;
                                    label = lang.toUpperCase();
                                } else {
                                    // Multi-tab language - include tab name in key
                                    const tabNameCleaned = tabInfo.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                                    const exampleSuffix = exampleName !== 'default' ? `_${exampleName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}` : '';
                                    key = `${lang}_${tabNameCleaned}${exampleSuffix}`;
                                    label = tabInfo.name;
                                }
                                
                                // Only store if we have content and haven't already extracted this key
                                if (codeText && codeText.length > 0 && !requestDetails.codeSnippets[key]) {
                                    requestDetails.codeSnippets[key] = codeText;
                                    // Store the tab name as label
                                    if (!requestDetails.codeSnippets._labels) {
                                        requestDetails.codeSnippets._labels = {};
                                    }
                                    requestDetails.codeSnippets._labels[key] = label;
                                    snippetCount++;
                                    console.log(`         ✓ Stored ${key} with label "${label}"`);
                                }
                            } catch (tabError) {
                                console.log(`      ⚠️ Error processing tab "${tabInfo.name}": ${tabError.message}`);
                            }
                        }
                    } else {
                        console.log(`      ⚠️ No tabs found for extraction`);
                    }
                } catch (langError) {
                    console.log(`      ⚠️ Error processing language "${lang}": ${langError.message}`);
                }
            }
        }

        if (snippetCount === 0) {
            console.log(`\n   📋 No API Explorer snippets found; scanning rendered guide code blocks...`);
            const guideSnippets = await page.evaluate(() => {
                const headings = Array.from(document.querySelectorAll('h2, h3, h4, h5'));

                return Array.from(document.querySelectorAll('pre'))
                    .map((element, index) => {
                        const code = element.textContent?.trim() || '';
                        if (!/^curl\s/i.test(code) || !/https:\/\/apis\.(sandbox\.)?globalpay\.com\/ucp\//i.test(code)) {
                            return null;
                        }

                        const precedingHeadings = headings.filter(heading =>
                            heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
                        );
                        const heading = precedingHeadings.at(-1)?.textContent?.trim() || `Request ${index + 1}`;

                        return { heading, code };
                    })
                    .filter(Boolean);
            });

            guideSnippets.forEach((snippet, index) => {
                const name = snippet.heading.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
                const key = `curl_${name || 'request'}_${index + 1}`;
                requestDetails.codeSnippets[key] = snippet.code;
                requestDetails.codeSnippets._labels ??= {};
                requestDetails.codeSnippets._labels[key] = snippet.heading;
                snippetCount++;
            });

            if (guideSnippets.length > 0) {
                availableLanguages = ['curl'];
                console.log(`      ✓ Extracted ${guideSnippets.length} executable cURL request(s) from guide`);
            }
        }
        
        // ===== TASK 3: EXTRACT RESPONSE CODE DEFINITIONS =====
        console.log(`\n   📋 TASK 3: Extracting response code definitions...`);
        
        try {
            // Find response code dropdown button using Blueprint button selector
            // Response code button: class="bp5-button bp5-minimal" with text containing status code
            const foundStatusCodes = new Map();
            let responseCodeSelectorButton = null;
            
            // Strategy 1: Look for Blueprint buttons with status codes (200 Success, etc)
            const responseCodeButtons = await page.locator('button.bp5-button.bp5-minimal').all();
            
            for (const btn of responseCodeButtons) {
                try {
                    const btnText = await btn.textContent();
                    const match = btnText?.match(/(\d{3})\s+(.+)/);
                    if (match) {
                        const code = match[1];
                        const desc = match[2].trim();
                        foundStatusCodes.set(code, `${code} ${desc}`);
                        responseCodeSelectorButton = btn;
                        console.log(`      ✓ Found response code button: ${code} ${desc}`);
                        
                        // Click to open dropdown and get all options
                        try {
                            await btn.click();
                            await page.waitForTimeout(700);
                            
                            // Extract all menu items from dropdown
                            const menuItems = await page.locator('a[role="menuitem"]').allTextContents();
                            for (const item of menuItems) {
                                const itemMatch = item?.match(/(\d{3})\s+(.+)/);
                                if (itemMatch) {
                                    const itemCode = itemMatch[1];
                                    const itemDesc = itemMatch[2].trim();
                                    foundStatusCodes.set(itemCode, `${itemCode} ${itemDesc}`);
                                }
                            }
                            
                            // Close dropdown
                            await btn.click();
                            await page.waitForTimeout(500);
                        } catch (dropdownError) {
                            // Continue if can't open dropdown
                        }
                        
                        break; // Found the main response code button, can stop
                    }
                } catch (e) {
                    // Continue to next button
                }
            }
            
            // Strategy 2: If no buttons found, try looking in menu items directly
            if (foundStatusCodes.size === 0) {
                try {
                    const statusCodeSelectors = [
                        'a[role="menuitem"] div.bp5-text-overflow-ellipsis',
                        'a[role="menuitem"]',
                        '[class*="status"][class*="code"]'
                    ];
                    
                    for (const selector of statusCodeSelectors) {
                        try {
                            const codeElements = await page.locator(selector).all();
                            for (const elem of codeElements) {
                                try {
                                    const text = await elem.textContent();
                                    const match = text?.match(/^(\d{3})\s+(.+)$/);
                                    if (match) {
                                        const code = match[1];
                                        const desc = match[2];
                                        foundStatusCodes.set(code, `${code} ${desc}`);
                                        console.log(`      ✓ Found response code: ${code} ${desc}`);
                                    }
                                } catch (e) {
                                    // Continue
                                }
                            }
                        } catch (selectorError) {
                            // Try next selector
                        }
                        
                        if (foundStatusCodes.size > 0) break;
                    }
                } catch (e) {
                    // Continue to fallback
                }
            }
            
            // Fallback: Parse from page text
            if (foundStatusCodes.size === 0) {
                const pageText = await page.evaluate(() => document.body.innerText);
                const statusMatches = pageText.match(/(\d{3})\s+(Success|OK|Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Server Error|Service Unavailable|Bad Gateway|Timeout|Not Implemented|Internal Server Error|Unprocessable Entity|Created|Accepted|Conflict|Gone|Unprocessable Entity)/gi) || [];
                
                for (const match of statusMatches) {
                    const parts = match.trim().split(/\s+/);
                    const code = parts[0];
                    const desc = parts.slice(1).join(' ');
                    if (/^\d{3}$/.test(code)) {
                        foundStatusCodes.set(code, `${code} ${desc}`);
                    }
                }
            }
            
            if (foundStatusCodes.size > 0) {
                requestDetails.documentedStatusCodes = Array.from(foundStatusCodes.keys()).sort();
                requestDetails.documentedStatusCodeDescriptions = Object.fromEntries(foundStatusCodes);
                console.log(`      ✓ Found ${foundStatusCodes.size} response codes`);
            } else {
                console.log(`      ⚠️ No response codes found`);
            }

            // ===== TASK 3b: EXTRACT ENDPOINT-SPECIFIC EXPECTED error_code VALUES =====
            // The response-code selector above only tells us the documented HTTP status
            // codes exist - it doesn't tell us what the API actually returns for each one.
            // For every documented status, select it in the (synced) response-code dropdown
            // and read the "possible values" enumeration for the `error_code` field in the
            // "Response Parameters" documentation panel. This is endpoint-specific ground
            // truth (e.g. a 400 on one endpoint may only ever return MANDATORY_DATA_MISSING,
            // while another may also return INVALID_TRANSACTION_ACTION) that we later use to
            // verify live test responses actually match what's documented, not just that the
            // HTTP status number happens to line up.
            if (responseCodeSelectorButton && foundStatusCodes.size > 0) {
                console.log(`      🔍 Extracting documented error_code values per status...`);
                for (const [code, label] of foundStatusCodes) {
                    try {
                        await responseCodeSelectorButton.click();
                        await page.waitForTimeout(400);

                        const menuItem = page.locator('a[role="menuitem"]', { hasText: label }).first();
                        if (await menuItem.count() === 0) {
                            continue;
                        }
                        await menuItem.click();
                        await page.waitForTimeout(500);

                        const responseSection = page.locator('div.response-section', {
                            has: page.locator('h6', { hasText: 'Response Parameters' })
                        }).first();
                        const errorCodeRow = responseSection.locator('div.api-explorer__model-row', {
                            has: page.locator('span.api-explorer__model-row-name', { hasText: /^error_code$/ })
                        }).first();

                        if (await errorCodeRow.count() > 0) {
                            const showValuesBtn = errorCodeRow.locator('button', { hasText: 'Show Values' });
                            if (await showValuesBtn.count() > 0) {
                                await showValuesBtn.click();
                                await page.waitForTimeout(300);
                            }
                            const values = (await errorCodeRow.locator('ul li').allTextContents())
                                .map(v => v.trim())
                                .filter(Boolean);
                            if (values.length > 0) {
                                requestDetails.documentedErrorCodesByStatus[code] = values;
                                console.log(`         ✓ ${code}: ${values.join(', ')}`);
                            }
                        }
                    } catch (perCodeError) {
                        // Some status codes (e.g. 2xx success) don't expose an error_code
                        // field at all - that's expected, so just move on to the next code.
                    }
                }
            }
        } catch (statusError) {
            console.log(`      ⚠️ Error extracting response codes: ${statusError.message}`);
        }
        
        // ===== TASK 4: EXTRACT FULL ENDPOINT DOCUMENTATION =====
        console.log(`\n   📋 TASK 4: Extracting endpoint documentation...`);
        
        try {
            // Extract HTTP method
            const pageText = await page.evaluate(() => document.body.innerText);
            const firstCurlSnippet = Object.entries(requestDetails.codeSnippets)
                .find(([key, code]) => key !== '_labels' && typeof code === 'string' && /^curl\s/i.test(code))?.[1];
            const parsedCurl = firstCurlSnippet ? parseCurlSnippet(firstCurlSnippet) : null;

            if (parsedCurl) {
                requestDetails.method = parsedCurl.method;
                requestDetails.url = parsedCurl.url;
                requestDetails.headers = parsedCurl.headers;
                requestDetails.body = parsedCurl.body;
                console.log(`      ✓ HTTP Method: ${requestDetails.method}`);
                console.log(`      ✓ Endpoint URL: ${requestDetails.url.substring(0, 60)}...`);
            } else {
                const methodMatch = pageText.match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD)\b/i);
                const urlMatch = pageText.match(/https?:\/\/apis\.(?:sandbox\.)?globalpay\.com\/ucp\/[^\s"'<>]+/i);
                requestDetails.method = methodMatch?.[1]?.toUpperCase() || null;
                requestDetails.url = urlMatch?.[0] || null;
            }
            
            // Extract headers from first code snippet
            const headerPatterns = [
                /Authorization:\s*Bearer\s+[\w\.]+/i,
                /Content-Type:\s*application\/json/i,
                /X-GP-Version:\s*[\d-]+/i
            ];
            
            for (const pattern of headerPatterns) {
                const match = pageText.match(pattern);
                if (match) {
                    const [key, value] = match[0].split(':').map(s => s.trim());
                    requestDetails.headers[key] = value;
                }
            }
            
            if (Object.keys(requestDetails.headers).length > 0) {
                console.log(`      ✓ Found ${Object.keys(requestDetails.headers).length} header requirements`);
            }
            
            // Extract request/response examples from code snippets
            for (const [key, code] of Object.entries(requestDetails.codeSnippets)) {
                try {
                    if (code.startsWith('{') && code.endsWith('}')) {
                        const jsonData = JSON.parse(code);
                        
                        // Detect if this is a request or response
                        if (hasRequestSignature(jsonData)) {
                            requestDetails.body = jsonData;
                            console.log(`      ✓ Extracted request body structure`);
                        } else if (hasResponseSignature(jsonData)) {
                            requestDetails.responseExamples[key] = jsonData;
                        }
                    }
                } catch (parseError) {
                    // Not JSON, continue
                }
            }
            
        } catch (docError) {
            console.log(`      ⚠️ Error extracting documentation: ${docError.message}`);
        }
        
        console.log(`\n   ✅ Extraction complete!`);
        console.log(`      • Code snippets: ${Object.keys(requestDetails.codeSnippets).length}`);
        console.log(`      • Languages: ${availableLanguages.join(', ')}`);
        console.log(`      • Response codes: ${requestDetails.documentedStatusCodes.join(', ')}`);
        console.log(`      • HTTP Method: ${requestDetails.method || 'Unknown'}`);
            
    } catch (error) {
        console.log(`   ❌ Extraction error: ${error.message}`);
    }
    
    // Add available languages to request details
    requestDetails.availableLanguages = availableLanguages;
    
    return requestDetails;
}

// Generic fallback reference of error_code values Global Payments documents per HTTP
// status, compiled from https://developer.globalpayments.com/api/definitions/responses
// (accessed 2026-09-24). Used only when an endpoint's own documentation page doesn't
// yield endpoint-specific values via TASK 3b in extractFromEndpoint, so live test
// validation still has *some* documented basis to check response content against.
const GP_ERROR_CODES_BY_STATUS_FALLBACK = {
    '400': ['INVALID_REQUEST_DATA', 'MANDATORY_DATA_MISSING', 'INVALID_TRANSACTION_ACTION', 'INVALID_PAYMENT_METHOD_ACTION', 'INVALID_BATCH_ACTION', 'INVALID_DISPUTE_ACTION'],
    '401': ['NOT_AUTHENTICATED'],
    '403': ['ACTION_NOT_AUTHORIZED'],
    '404': ['RESOURCE_NOT_FOUND'],
    '405': ['INVALID_TRANSACTION_ACTION'],
    '409': ['DUPLICATE_TRANSACTION', 'DUPLICATE_ACTION'],
    '500': ['SYSTEM_ERROR_DOWNSTREAM'],
    '501': ['UNKNOWN_RESPONSE', 'SYSTEM_ERROR_DOWNSTREAM'],
    '502': ['SYSTEM_ERROR_DOWNSTREAM', 'UNAUTHORIZED_DOWNSTREAM', 'DUPLICATE_TRANSACTION'],
    '504': ['TIMEOUT_DOWNSTREAM']
};

// Checks whether a live test's response body is actually consistent with what Global
// Payments documents for the given status code, rather than trusting the HTTP status
// number alone. `documentedErrorCodes` is the endpoint-specific list scraped from the
// docs page (TASK 3b) when available, falling back to the generic reference table.
function validateResponseContent(code, responseBody, documentedErrorCodes) {
    const isSuccessScenario = code === 'baseline' || /^2\d{2}$/.test(code);

    if (isSuccessScenario) {
        if (!responseBody || typeof responseBody !== 'object') {
            return { contentValid: false, reason: 'Response body is missing or not a JSON object' };
        }
        if (responseBody.error_code || responseBody.error) {
            return {
                contentValid: false,
                reason: `Expected a successful payload but received error_code "${responseBody.error_code}"`
            };
        }
        return { contentValid: true, reason: 'Response body does not contain an error payload' };
    }

    if (!responseBody || typeof responseBody !== 'object') {
        return { contentValid: false, reason: 'Response body is missing or not a JSON object' };
    }

    const actualErrorCode = responseBody.error_code;
    if (!actualErrorCode) {
        return {
            contentValid: false,
            reason: `Expected an error_code describing the ${code} failure, but none was present in the response`
        };
    }

    const expectedErrorCodes = (documentedErrorCodes && documentedErrorCodes.length > 0)
        ? documentedErrorCodes
        : GP_ERROR_CODES_BY_STATUS_FALLBACK[code];

    if (!expectedErrorCodes || expectedErrorCodes.length === 0) {
        return {
            contentValid: true,
            reason: `No documented error_code reference available for ${code}; skipped content check`
        };
    }

    if (!expectedErrorCodes.includes(actualErrorCode)) {
        return {
            contentValid: false,
            reason: `error_code "${actualErrorCode}" is not one of the codes Global Payments documents for HTTP ${code} (expected one of: ${expectedErrorCodes.join(', ')})`
        };
    }

    return {
        contentValid: true,
        reason: `error_code "${actualErrorCode}" matches documented ${code} behavior`
    };
}

// GP resource ID prefixes that are stateful — they reference objects that must
// be created first in a prior flow step and won't exist in a fresh sandbox test.
const RESOURCE_ID_PREFIXES = ['AUT_', 'PYR_', 'PMT_', 'TRN_', 'BAT_', 'DEP_', 'DIS_', 'LNK_', 'ACT_', 'MER_', 'ACC_'];

function isDocSampleResourceId(value) {
    if (typeof value !== 'string') return false;
    return RESOURCE_ID_PREFIXES.some(prefix => value.startsWith(prefix));
}

// Recursively walk the body and remove any field whose value is a doc-sample
// resource ID (e.g. AUT_d455464a..., PYR_84fd9c...).  The field is removed
// rather than nulled so GP doesn't reject it as an unexpected null.
function stripNestedResourceIds(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (isDocSampleResourceId(value)) {
            console.log(`   🧹 Stripped doc-sample resource ID field "${key}": ${value}`);
            continue; // drop the field
        }
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const nested = stripNestedResourceIds(value);
            // Only keep the nested object if it still has keys after stripping
            if (Object.keys(nested).length > 0) {
                result[key] = nested;
            } else {
                console.log(`   🧹 Stripped empty nested object "${key}" after ID removal`);
            }
        } else {
            result[key] = value;
        }
    }
    return result;
}

function hasRequestSignature(obj) {
    const requestFields = ['amount', 'card', 'payment', 'account_id', 'currency', 'reference_id'];
    return requestFields.some(field => obj.hasOwnProperty(field));
}

function hasHeaderSignature(obj) {
    return Object.keys(obj).some(key => 
        key.toLowerCase().includes('authorization') || 
        key.toLowerCase().includes('content-type') ||
        key.toLowerCase().includes('x-gp')
    );
}

function hasResponseSignature(obj) {
    const responseFields = [
        // Success response fields
        'id', 'status', 'time_created', 'merchant_id', 'account_id', 'transaction_id', 'batch_id', 'token',
        'total_record_count', 'current_page_size', 'merchant_name', 'accounts', 'scope',
        // Error response fields
        'error', 'message', 'error_code', 'detailed_error_code', 'detailed_error_description',
        'response_code', 'response_message', 'gateway_response_code', 'gateway_response_message',
        // Common API response indicators
        'success', 'result', 'data', 'timestamp', 'request_id'
    ];
    return responseFields.some(field => obj.hasOwnProperty(field)) ||
           // Check for nested error objects
           (obj.error && typeof obj.error === 'object') ||
           // Check for response wrapper patterns
           (obj.response && typeof obj.response === 'object');
}

async function runExternalSdkVerifier(command, args, cwd, envVars, fallbackResult) {
    const startedAt = Date.now();

    try {
        const { stdout } = await execFileAsync(command, args, {
            cwd,
            env: {
                ...process.env,
                GP_API_APP_ID: envVars.GP_API_APP_ID,
                GP_API_APP_KEY: envVars.GP_API_APP_KEY
            },
            timeout: 30000,
            windowsHide: true
        });
        const resultLine = stdout.trim().split(/\r?\n/).reverse().find(line => line.trim().startsWith('{'));

        if (!resultLine) {
            throw new Error('SDK verifier did not return JSON');
        }

        return JSON.parse(resultLine);
    } catch (error) {
        const details = error.code === 'ENOENT'
            ? `${fallbackResult.language} runtime is not installed or not on PATH`
            : (error.stderr || error.message || 'SDK verifier failed');

        return {
            ...fallbackResult,
            verified: false,
            environment: 'TEST',
            authentication: 'failed',
            responseTime: Date.now() - startedAt,
            error: String(details).trim().substring(0, 500)
        };
    }
}

export async function verifyAllGlobalPaymentsSdks() {
    const envVars = await loadEnvVars();

    const configurationErrors = validateSdkConfiguration(envVars);
    if (configurationErrors.length > 0) {
        const error = `Configuration required: ${configurationErrors.join('; ')}`;
        return [
            { sdk: 'globalpayments-api', language: 'Node.js', version: '3.11.1' },
            { sdk: 'globalpayments/php-sdk', language: 'PHP', version: '14.4.2' },
            { sdk: 'com.globalpayments:globalpayments-sdk', language: 'Java', version: '15.1.14' }
        ].map(verification => ({
            ...verification,
            verified: false,
            environment: 'TEST',
            authentication: 'not_attempted',
            responseTime: 0,
            error
        }));
    }

    const nodeDirectory = path.join(repoRoot, 'sdk-verifiers', 'node');
    const phpDirectory = path.join(repoRoot, 'sdk-verifiers', 'php');
    const javaDirectory = path.join(repoRoot, 'sdk-verifiers', 'java');
    const javaFallback = {
        sdk: 'com.globalpayments:globalpayments-sdk',
        language: 'Java',
        version: '15.1.14'
    };
    const javaVerification = fs.readFile(path.join(javaDirectory, 'classpath.txt'), 'utf8')
        .then(javaDependencies => {
            const javaClasspath = [path.join(javaDirectory, 'target', 'classes'), javaDependencies.trim()].join(path.delimiter);
            return runExternalSdkVerifier('java', ['-cp', javaClasspath, 'SdkVerifier'], javaDirectory, envVars, javaFallback);
        })
        .catch(error => ({
            ...javaFallback,
            verified: false,
            environment: 'TEST',
            authentication: 'failed',
            responseTime: 0,
            error: `Java verifier setup required: ${error.message}`
        }));

    return Promise.all([
        runExternalSdkVerifier(process.execPath, ['verify.js'], nodeDirectory, envVars, {
            sdk: 'globalpayments-api',
            language: 'Node.js',
            version: '3.11.1'
        }),
        runExternalSdkVerifier('php', ['verify.php'], phpDirectory, envVars, {
            sdk: 'globalpayments/php-sdk',
            language: 'PHP',
            version: '14.4.2'
        }),
        javaVerification
    ]);
}

export async function testAllSnippets(extractedData) {
    const documentedStatusCodes = extractedData.documentedStatusCodes || [];
    const documentedErrorCodesByStatus = extractedData.documentedErrorCodesByStatus || {};
    
    // Attempt to generate fresh token, but don't fail if we can't
    try {
        await generateFreshToken();
    } catch (error) {
        console.warn(`⚠️  Could not generate fresh token: ${error.message}`);
        console.log('   Using existing token if available...');
    }
    
    // Parse code snippets and group by example
    const exampleRequests = parseSnippetsByExample(extractedData.codeSnippets);
    
    // If no examples found, create a default example using the base extracted data
    if (Object.keys(exampleRequests).length === 0) {
        console.log(`   ℹ️  No named examples found, creating default example from extracted data`);
        exampleRequests['default'] = {
            url: extractedData.url,
            headers: extractedData.headers || {},
            body: extractedData.body
        };
    }
    
    console.log(`\n🧪 Testing ${Object.keys(exampleRequests).length} example(s) against API...`);
    console.log(`📋 Documented status codes: ${documentedStatusCodes.join(', ')}`);
    
    const results = {
        documentedStatusCodes: documentedStatusCodes,
        sdkVerifications: [],
        exampleTests: {}
    };
    
    // Test each example individually - including all status code scenarios
    for (const [exampleName, exampleData] of Object.entries(exampleRequests)) {
        console.log(`\n📂 Testing example: "${exampleName}"...`);
        
        // Build base request data for this example
        const baseRequestData = {
            method: exampleData.method || extractedData.method || 'POST',
            url: exampleData.url || extractedData.url,
            headers: exampleData.headers || {},
            body: exampleData.body,
            documentedStatusCodes: documentedStatusCodes
        };
        
        console.log(`   🔗 URL: ${baseRequestData.url}`);
        console.log(`   📦 Body fields: ${baseRequestData.body ? Object.keys(baseRequestData.body).join(', ') : 'none'}`);
        
        // Test normal request (200) plus all documented status codes for this example
        const exampleTestResults = {
            exampleName: exampleName,
            url: baseRequestData.url,
            method: baseRequestData.method,
            statusCodeTests: {}
        };
        
        // Run status code tests for this specific example
        console.log(`\n   🎯 Testing status code scenarios for "${exampleName}"...`);
        exampleTestResults.statusCodeTests = await testStatusCodesForExample(baseRequestData, documentedStatusCodes, documentedErrorCodesByStatus);
        
        results.exampleTests[exampleName] = exampleTestResults;
    }

    results.sdkVerifications = await verifyAllGlobalPaymentsSdks();
    for (const verification of results.sdkVerifications) {
        if (verification.verified) {
            console.log(`✅ Official Global Payments ${verification.language} SDK verification passed`);
        } else {
            console.warn(`⚠️  Official Global Payments ${verification.language} SDK verification failed: ${verification.error || verification.message}`);
        }
    }
    
    return results;
}

function parseSnippetsByExample(codeSnippets) {
    const examples = {};
    
    // Group snippets by example name
    for (const [key, code] of Object.entries(codeSnippets)) {
        if (key === '_labels') continue;
        
        const parts = key.split('_');
        const lang = parts[0];
        
        // Extract example name using same logic as frontend
        // Key format: json_url___query_create_a_paylink, json_headers_create_a_paylink, curl_create_a_paylink
        let exampleName = 'default';
        
        if (lang === 'json') {
            // For JSON, we need to skip the tab name part
            // Tab names: url___query, headers, body
            if (key.includes('_url___query_')) {
                // Split on _url___query_ and take everything after
                const afterSplit = key.split('_url___query_')[1];
                if (afterSplit && afterSplit.length > 0) {
                    exampleName = afterSplit;
                }
            } else if (key.includes('_headers_')) {
                // Split on _headers_ and take everything after
                const afterSplit = key.split('_headers_')[1];
                if (afterSplit && afterSplit.length > 0) {
                    exampleName = afterSplit;
                }
            } else if (key.includes('_body_')) {
                // Split on _body_ and take everything after
                const afterSplit = key.split('_body_')[1];
                if (afterSplit && afterSplit.length > 0) {
                    exampleName = afterSplit;
                }
            }
        } else {
            // For other languages (curl, etc), everything after language is the example name
            const afterLang = parts.slice(1).join('_');
            if (afterLang && afterLang.length > 0) {
                exampleName = afterLang;
            }
        }
        
        console.log(`      📝 Processing snippet: ${key} -> example: ${exampleName}`);
        
        if (!examples[exampleName]) {
            examples[exampleName] = {
                url: null,
                headers: null,
                body: null
            };
        }
        
        // Parse JSON snippets to extract data
        if (lang === 'json') {
            try {
                if (key.includes('url___query')) {
                    // Extract URL from URL & QUERY tab
                    const urlMatch = code.match(/https?:\/\/[^\s"'\n]+/);
                    if (urlMatch) {
                        examples[exampleName].url = urlMatch[0];
                    }
                } else if (key.includes('headers')) {
                    // Parse headers JSON
                    const parsed = JSON.parse(code);
                    examples[exampleName].headers = parsed;
                } else if (key.includes('body')) {
                    // Parse body JSON
                    const parsed = JSON.parse(code);
                    examples[exampleName].body = parsed;
                }
            } catch (parseError) {
                console.log(`      ⚠️ Could not parse ${key}: ${parseError.message}`);
            }
        } else if (lang === 'curl') {
            const parsedCurl = parseCurlSnippet(code);
            if (parsedCurl) {
                examples[exampleName] = parsedCurl;
            }
        }
    }
    
    console.log(`   📊 Parsed ${Object.keys(examples).length} example(s): ${Object.keys(examples).join(', ')}`);
    
    return examples;
}

function parseCurlSnippet(code) {
    const urlMatch = code.match(/https?:\/\/apis\.(?:sandbox\.)?globalpay\.com\/ucp\/[^\s'"\\]+/i);
    if (!urlMatch) return null;

    const explicitMethod = code.match(/--request\s+(GET|POST|PUT|DELETE|PATCH|HEAD)/i)?.[1];
    const headers = {};
    for (const match of code.matchAll(/--header\s+['"]([^:'"]+):\s*([^'"]+)['"]/gi)) {
        headers[match[1].trim()] = match[2].trim();
    }

    const bodyMatch = code.match(/--data(?:-raw)?\s+'([\s\S]*?)'\s*(?:\\\s*)?$/i)
        || code.match(/--data(?:-raw)?\s+"([\s\S]*?)"\s*(?:\\\s*)?$/i);
    let body = null;
    if (bodyMatch) {
        try {
            body = JSON.parse(bodyMatch[1]);
        } catch {
            body = bodyMatch[1];
        }
    }

    return {
        method: (explicitMethod || (bodyMatch ? 'POST' : 'GET')).toUpperCase(),
        url: urlMatch[0],
        headers,
        body
    };
}

async function testStatusCodesForExample(baseRequestData, documentedCodes, documentedErrorCodesByStatus = {}) {
    const testResults = {};
    const codesToTest = documentedCodes.length > 0 ? documentedCodes : ['baseline'];
    
    for (const code of codesToTest) {
        console.log(`      🔬 Testing scenario for ${code}...`);
        
        try {
            let result;
            let requestData = { ...baseRequestData };
            
            switch (code) {
                case 'baseline':
                    console.log(`         Scenario: Execute extracted documentation request`);
                    result = await testLiveAPI(requestData);
                    break;

                case '200':
                    // Test 1: Valid request with proper auth
                    console.log(`         Scenario: Valid request with proper authentication`);
                    result = await testLiveAPI(requestData);
                    break;
                    
                case '400':
                    // Test 2: Invalid parameters (bad data in request)
                    console.log(`         Scenario: Request with invalid parameters`);
                    requestData = { ...baseRequestData };
                    requestData.url = requestData.url + '?page_size=invalid&from_time_created=not_a_date';
                    result = await testLiveAPI(requestData);
                    break;
                    
                case '401':
                    // Test 3: No auth or invalid token
                    console.log(`         Scenario: Request with invalid/missing authentication`);
                    requestData = { ...baseRequestData };
                    requestData.useInvalidToken = true;
                    result = await testLiveAPI(requestData);
                    break;
                    
                case '403':
                    // Test 4: Insufficient permissions. Prefer swapping just the merchant
                    // segment of the *actual* endpoint URL so we're still exercising the
                    // documented request - falling back to a generic restricted-merchant
                    // probe only when the endpoint has no merchant-scoped path segment.
                    console.log(`         Scenario: Request to restricted resource`);
                    requestData = { ...baseRequestData };
                    if (/\/merchants\/[^\/?]+/i.test(requestData.url)) {
                        requestData.url = requestData.url.replace(/\/merchants\/[^\/?]+/i, '/merchants/MER_RESTRICTED_ACCESS_DENIED');
                    } else {
                        requestData.url = 'https://apis.sandbox.globalpay.com/ucp/merchants/MER_RESTRICTED_ACCESS_DENIED/accounts';
                    }
                    result = await testLiveAPI(requestData);
                    break;
                    
                case '404': {
                    // Test 5: Non-existent resource. Append a clearly-fake path segment
                    // instead of replacing the last one - replacing it risks turning a
                    // collection endpoint (e.g. ".../accounts") into a completely different,
                    // coincidentally-valid route (e.g. a transaction "action" URL), which
                    // triggers an unrelated error under a misleading 404 status.
                    console.log(`         Scenario: Request to non-existent endpoint`);
                    requestData = { ...baseRequestData };
                    const [basePath, queryString] = requestData.url.split('?');
                    requestData.url = `${basePath.replace(/\/$/, '')}/does-not-exist-${Date.now()}`
                        + (queryString ? `?${queryString}` : '');
                    result = await testLiveAPI(requestData);
                    break;
                }
                    
                default:
                    // Codes like 405/409/500/501/502/503/504 typically require a genuine
                    // downstream/server failure, a real duplicate-processing race, or a
                    // method that's actually unsupported - none of which can be safely or
                    // deterministically reproduced by mutating a request against the live
                    // sandbox. Recording them as "skipped" (rather than silently dropping
                    // them, or reusing the baseline request and reporting a false failure)
                    // keeps the report honest about what was and wasn't actually verified.
                    console.log(`         Scenario: ${getScenarioName(code)} — cannot be reliably reproduced against the sandbox`);
                    testResults[code] = {
                        scenario: getScenarioName(code),
                        expectedCode: code,
                        actualCode: null,
                        matched: null,
                        skipped: true,
                        skipReason: 'This status typically requires a genuine downstream/server failure or a duplicate-processing condition that cannot be safely or deterministically reproduced against the sandbox.',
                        statusText: 'Skipped',
                        responseTime: 0
                    };
                    continue;
            }
            
            // A test only truly "matches" when both the HTTP status AND the response
            // content (error_code, for error scenarios) are consistent with what Global
            // Payments documents - a coincidentally-correct status code with an unrelated
            // error body is not a pass.
            const statusCodeMatched = code === 'baseline'
                ? result.statusCode >= 200 && result.statusCode < 300
                : String(result.statusCode) === String(code);
            const effectiveCode = code === 'baseline' ? String(result.statusCode) : code;
            const contentCheck = validateResponseContent(effectiveCode, result.body, documentedErrorCodesByStatus[effectiveCode]);
            const matched = statusCodeMatched && contentCheck.contentValid;

            testResults[code] = {
                scenario: getScenarioName(code),
                expectedCode: code === 'baseline' ? '2xx' : code,
                actualCode: result.statusCode,
                matched: matched,
                statusCodeMatched: statusCodeMatched,
                contentValid: contentCheck.contentValid,
                contentValidationNote: contentCheck.reason,
                statusText: result.statusText,
                responseTime: result.responseTime,
                responseBody: result.body,
                method: result.method,
                url: result.url
            };
            
            if (matched) {
                console.log(`         ✅ ${code === 'baseline' ? 'Request succeeded' : `Successfully triggered ${code}`} - ${contentCheck.reason}`);
            } else if (statusCodeMatched && !contentCheck.contentValid) {
                console.log(`         ⚠️  Got expected HTTP ${result.statusCode}, but response content didn't match: ${contentCheck.reason}`);
            } else {
                console.log(`         ⚠️  Got ${result.statusCode} instead of ${code === 'baseline' ? 'a 2xx response' : code}`);
            }
            
        } catch (error) {
            console.log(`         ❌ Error testing ${code}: ${error.message}`);
            testResults[code] = {
                scenario: getScenarioName(code),
                expectedCode: code,
                actualCode: null,
                matched: false,
                error: error.message,
                statusText: 'Error',
                responseTime: 0
            };
        }
    }
    
    return testResults;
}

function getScenarioName(code) {
    const scenarios = {
        'baseline': 'Execute extracted documentation request',
        '200': 'Valid request with proper authentication',
        '400': 'Bad Request - invalid parameters',
        '401': 'Unauthorized - invalid/missing authentication',
        '403': 'Forbidden - insufficient permissions',
        '404': 'Not Found - non-existent endpoint',
        '405': 'Method not allowed',
        '409': 'Conflict / duplicate action',
        '500': 'Internal server error',
        '501': 'Not implemented',
        '502': 'Bad gateway',
        '503': 'Service unavailable',
        '504': 'Timeout'
    };
    return scenarios[code] || `HTTP ${code}`;
}

async function testLiveAPI(requestData) {
    try {
        // Load credentials
        const envVars = await loadEnvVars();
        
        // Load token
        const tokenFile = path.join(process.cwd(), 'gp-access-token.json');
        const tokenData = JSON.parse(await fs.readFile(tokenFile, 'utf8'));
        
        // Check if this is the access token endpoint (special case - doesn't use Bearer auth)
        const isAccessTokenEndpoint = requestData.url?.includes('/accesstoken');
        
        // Use invalid token if requested (to test 401)
        const token = requestData.useInvalidToken ? 'INVALID_TOKEN_12345' : tokenData.token;
        
        // Build headers - merge example headers with required auth headers
        // Filter out 'authorization' and placeholder values from example headers
        const exampleHeaders = requestData.headers || {};
        const filteredExampleHeaders = Object.keys(exampleHeaders).reduce((acc, key) => {
            const value = exampleHeaders[key];
            // Skip authorization header and any placeholder values
            if (key.toLowerCase() !== 'authorization' && 
                value !== 'value_needed' && 
                value !== 'YOUR_API_KEY' &&
                value !== 'YOUR_TOKEN') {
                acc[key] = value;
            }
            return acc;
        }, {});
        
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-GP-Version': '2021-03-22',
            ...filteredExampleHeaders
        };
        
        // Only add Bearer token auth if NOT the access token endpoint
        if (!isAccessTokenEndpoint) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        if (envVars.GP_API_APP_ID) {
            headers['X-GP-Api-Key'] = envVars.GP_API_APP_ID;
        }
        
        let requestBody = requestData.body;
        if (requestData.method === 'POST' && requestBody) {
            // Special handling for access token endpoint - use real app credentials
            if (isAccessTokenEndpoint) {
                const nonce = Date.now().toString() + Math.random().toString(36).substring(2);
                const secret = crypto.createHash('sha512').update(nonce + envVars.GP_API_APP_KEY).digest('hex');
                
                requestBody = {
                    app_id: envVars.GP_API_APP_ID,
                    nonce: nonce,
                    secret: secret,
                    grant_type: 'client_credentials'
                };
                
                // Preserve any additional fields from the example (like permissions, seconds_to_expire)
                const exampleBody = requestData.body || {};
                if (exampleBody.permissions) {
                    requestBody.permissions = exampleBody.permissions;
                }
                if (exampleBody.seconds_to_expire) {
                    requestBody.seconds_to_expire = exampleBody.seconds_to_expire;
                }
            } else {
                // Normal endpoint handling - replace placeholder values with real ones
                // Replace placeholder merchant_id with real merchant_id from token
                if (requestBody.merchant_id && tokenData.scope?.merchant_id) {
                    requestBody = {
                        ...requestBody,
                        merchant_id: tokenData.scope.merchant_id
                    };
                }
                
                // Add or replace account_id with real account_id from token
                if (tokenData.scope?.accounts?.[0]?.id) {
                    requestBody = {
                        ...requestBody,
                        account_id: tokenData.scope.accounts[0].id
                    };
                }
                
                // Add or replace account_name with real account_name from token
                if (tokenData.scope?.accounts?.[0]?.name) {
                    requestBody = {
                        ...requestBody,
                        account_name: tokenData.scope.accounts[0].name
                    };
                }

                // Strip nested resource reference IDs that are doc sample values and
                // don't exist in this sandbox account (AUT_, PYR_, PMT_, TRN_, etc.).
                // These cause 404 RESOURCE_NOT_FOUND because they reference objects
                // from prior flow steps (e.g. 3DS auth sessions, stored payment tokens).
                requestBody = stripNestedResourceIds(requestBody);
            }
        }
        
        console.log(`📡 Making ${requestData.method} request to ${requestData.url}`);
        console.log(`📋 Headers:`, JSON.stringify(headers, null, 2));
        console.log(`📦 Request Body:`, requestBody ? JSON.stringify(requestBody, null, 2) : 'none');
        
        const startTime = Date.now();
        const response = await fetch(requestData.url, {
            method: requestData.method,
            headers: headers,
            body: requestBody ? JSON.stringify(requestBody) : undefined
        });
        const endTime = Date.now();
        
        const responseText = await response.text();
        let responseBody;
        try {
            responseBody = JSON.parse(responseText);
        } catch (e) {
            responseBody = responseText;
        }
        
        // Determine success based on API behavior
        const isAPISuccess = response.status === 200 || 
            (response.status === 400 && 
             (responseBody?.error_code === 'MANDATORY_DATA_MISSING' || 
              responseBody?.error_code === 'INVALID_REQUEST_DATA'));
        
        // Generate validation results
        const validation = {
            'Network connectivity': !!response.status,
            'Endpoint exists': response.status !== 404,
            'Authentication works': response.status !== 401,
            'Request structure valid': response.status === 400 && responseBody?.error_code || response.status < 400,
            'Structured API response': responseBody && typeof responseBody === 'object',
            'GP API response format': !!(
                responseBody?.error_code || 
                responseBody?.detailed_error_code ||
                responseBody?.transaction_id ||
                responseBody?.status ||
                responseBody?.merchant_id
            ),
            'Reasonable response time': (endTime - startTime) < 10000,
            'API integration functional': !!response.status && response.status !== 404 && response.status !== 401
        };
        
        // Check if the status code we received is one that's documented
        const documentedCodes = requestData.documentedStatusCodes || [];
        const receivedCodeMatch = documentedCodes.includes(String(response.status));
        
        return {
            statusCode: response.status,
            statusText: response.statusText,
            responseTime: endTime - startTime,
            responseHeaders: Object.fromEntries(response.headers.entries()),
            requestHeaders: headers,
            method: requestData.method,
            url: requestData.url,
            body: responseBody,
            success: isAPISuccess,
            authenticated: !!tokenData.token,
            validation: validation,
            documentedStatusCodes: documentedCodes,
            receivedStatusCodeIsDocumented: receivedCodeMatch,
            analysis: {
                isExpectedFormat: responseBody && typeof responseBody === 'object',
                hasErrorMessage: responseBody && (responseBody.error || responseBody.message || responseBody.error_code),
                responseSize: responseText.length,
                httpStatusFamily: Math.floor(response.status / 100) + 'xx',
                contentType: response.headers.get('content-type') || 'unknown',
                matchesDocumentation: receivedCodeMatch
            }
        };
        
    } catch (error) {
        console.log(`❌ Live API test failed: ${error.message}`);
        return {
            statusCode: null,
            statusText: 'Network Error',
            responseTime: 0,
            body: error.message,
            success: false,
            error: true,
            validation: {
                'Network connectivity': false,
                'Endpoint exists': false,
                'Authentication works': false,
                'Request structure valid': false,
                'Structured API response': false,
                'GP API response format': false,
                'Reasonable response time': false,
                'API integration functional': false
            }
        };
    }
}
