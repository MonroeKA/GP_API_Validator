// Simple script to create a self-contained HTML file with embedded data
import fs from 'fs';

function createSelfContainedHTML() {
    try {
        // Find the latest results file
        const files = fs.readdirSync('.')
            .filter(file => file.match(/^(api-responses|multi-endpoint-api-responses)-\d+\.json$/))
            .map(file => ({
                name: file,
                time: fs.statSync(file).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        if (files.length === 0) {
            console.log('❌ No results files found');
            return;
        }

        const latestFile = files[0].name;
        const resultsData = fs.readFileSync(latestFile, 'utf8');
        const htmlTemplate = fs.readFileSync('results-viewer.html', 'utf8');

        // Embed the data directly in the HTML
        const embeddedHTML = htmlTemplate.replace(
            '<div id="content">',
            `<div id="content">
            <script>
                // Embedded latest results data
                window.EMBEDDED_RESULTS = ${resultsData};
                
                // Auto-load on page load
                window.addEventListener('DOMContentLoaded', function() {
                    console.log('Auto-loading embedded results from: ${latestFile}');
                    displayResults(window.EMBEDDED_RESULTS);
                    
                    // Update upload section to show auto-loaded status
                    const uploadDiv = document.querySelector('.file-upload');
                    if (uploadDiv) {
                        uploadDiv.innerHTML = \`
                            <div style="text-align: center; padding: 20px; background: #d4edda; border: 2px solid #c3e6cb; border-radius: 10px;">
                                <h3 style="color: #155724; margin: 0 0 10px 0;">✅ Auto-loaded Latest Results</h3>
                                <p style="color: #155724; margin: 0 0 15px 0; font-size: 0.9em;">
                                    Currently showing: <strong>${latestFile}</strong><br>
                                    <span style="font-size: 0.8em;">Last updated: ${new Date(files[0].time).toLocaleString()}</span>
                                </p>
                                <details style="margin-top: 15px;">
                                    <summary style="cursor: pointer; color: #155724; font-weight: 600;">📁 Upload Different File</summary>
                                    <div style="margin-top: 15px;">
                                        <input type="file" id="jsonFile" accept=".json">
                                        <label for="jsonFile" style="display: inline-block; margin-top: 10px; padding: 8px 16px; background: #28a745; color: white; border-radius: 5px; cursor: pointer; font-size: 0.9em;">
                                            Choose File
                                        </label>
                                    </div>
                                </details>
                            </div>
                        \`;
                        
                        // Re-attach file upload handler
                        const fileInput = document.getElementById('jsonFile');
                        if (fileInput) {
                            fileInput.addEventListener('change', function(e) {
                                const file = e.target.files[0];
                                if (file) {
                                    const reader = new FileReader();
                                    reader.onload = function(e) {
                                        try {
                                            const newData = JSON.parse(e.target.result);
                                            displayResults(newData);
                                        } catch (error) {
                                            alert('Error parsing JSON file: ' + error.message);
                                        }
                                    };
                                    reader.readAsText(file);
                                }
                            });
                        }
                    }
                });
            </script>`
        );

        // Write the self-contained HTML file
        fs.writeFileSync('results-dashboard-autoload.html', embeddedHTML);
        
        console.log(`✅ Created self-contained dashboard: results-dashboard-autoload.html`);
        console.log(`📊 Auto-loaded data from: ${latestFile}`);
        console.log(`📅 Last updated: ${new Date(files[0].time).toLocaleString()}`);

    } catch (error) {
        console.error('❌ Error creating self-contained HTML:', error);
    }
}

createSelfContainedHTML();
