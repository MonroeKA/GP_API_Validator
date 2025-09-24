#!/usr/bin/env node
// Auto-update dashboard script
// Run this after generating new test results to update the dashboard

import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function updateDashboard() {
    console.log('🔄 Updating dashboard with latest results...');
    
    try {
        // Run the enhanced dashboard creation script
        await execAsync('node create-enhanced-dashboard.js');
        
        // Update the index page with the latest file info
        const files = fs.readdirSync('.')
            .filter(file => file.match(/^(api-responses|multi-endpoint-api-responses|multi-site-api-responses)-\d+\.json$/))
            .map(file => ({
                name: file,
                time: fs.statSync(file).mtime.getTime(),
                size: fs.statSync(file).size,
                type: file.includes('multi-site') ? 'multisite' : 
                      file.includes('multi-endpoint') ? 'multiendpoint' : 'single'
            }))
            .sort((a, b) => b.time - a.time);

        if (files.length > 0) {
            const latestFile = files[0];
            
            console.log(`✅ Dashboard updated successfully!`);
            console.log(`📊 Latest results: ${latestFile.name} (${latestFile.type})`);
            console.log(`📅 Generated: ${new Date(latestFile.time).toLocaleString()}`);
            console.log(`📄 File size: ${(latestFile.size / 1024).toFixed(1)} KB`);
            console.log(`🌐 Open: results-dashboard-autoload.html`);
            
            // Show summary by type
            const summary = files.reduce((acc, file) => {
                acc[file.type] = (acc[file.type] || 0) + 1;
                return acc;
            }, {});
            console.log(`📈 Results summary: ${Object.entries(summary).map(([type, count]) => `${count} ${type}`).join(', ')}`);
            
            // Optionally open the dashboard in the browser
            if (process.argv.includes('--open')) {
                console.log('🚀 Opening dashboard in browser...');
                const opener = process.platform === 'darwin' ? 'open' : 
                              process.platform === 'win32' ? 'cmd /c start ""' : 'xdg-open';
                exec(`${opener} results-dashboard-autoload.html`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error updating dashboard:', error.message);
        process.exit(1);
    }
}

updateDashboard();
