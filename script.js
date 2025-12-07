
document.addEventListener('DOMContentLoaded', () => {
    fetchData();
});

async function fetchData() {
    const url = 'https://docs.oracle.com/en-us/iaas/tools/public_ip_ranges.json';

    try {
        console.log(`Attempting to fetch data from: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log(`Successfully loaded data from: ${url}`);
        processAndRender(data);
        return; // Exit function on success
    } catch (error) {
        console.warn(`Failed to search from ${url}:`, error);
    }

    // If we get here, all fetches failed
    const errorMsg = 'Failed to load data from both live URL and local file. If you are opening this locally without a server, browsers block local file access (CORS).';
    console.error(errorMsg);
    document.getElementById('regions-container').innerHTML = `
        <div class="loading-state" style="color: #ef4444;">
            <p>${errorMsg}</p>
        </div>
    `;
}

function processAndRender(data) {
    let regions = data.regions.map(regionObj => {
        const enrichedCidrs = regionObj.cidrs.map(c => {
            const rangeInfo = cidrToRange(c.cidr);
            return {
                cidr: c.cidr,
                tags: c.tags,
                range: rangeInfo,
                ipCount: rangeInfo.count
            };
        });

        const totalIps = enrichedCidrs.reduce((sum, c) => sum + c.ipCount, 0);

        return {
            name: regionObj.region,
            cidrs: enrichedCidrs,
            count: enrichedCidrs.length,
            totalIps: totalIps
        };
    });

    // Filter for OCI tags ONLY
    regions = regions.map(region => {
        const ociCidrs = region.cidrs.filter(c => c.tags.includes('OCI'));
        const totalIps = ociCidrs.reduce((sum, c) => sum + c.ipCount, 0);
        return {
            ...region,
            cidrs: ociCidrs,
            count: ociCidrs.length,
            totalIps: totalIps
        };
    }).filter(r => r.count > 0);

    // Sort regions: Total IPs High to Low
    regions.sort((a, b) => b.totalIps - a.totalIps);

    // Update Header Stats
    updateStats(data.last_updated_timestamp, regions.length, regions.reduce((acc, r) => acc + r.count, 0));

    // Render Regions
    const container = document.getElementById('regions-container');
    container.innerHTML = '';

    // Use fragment for performance
    const fragment = document.createDocumentFragment();

    regions.forEach((region, index) => {
        const card = createRegionCard(region, index);
        fragment.appendChild(card);
    });

    container.appendChild(fragment);

    // Setup Search
    setupSearch();
}

function setupSearch() {
    const searchInput = document.getElementById('region-search');

    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.region-card');
        let hasResults = false;

        cards.forEach(card => {
            const regionName = card.querySelector('.region-name').textContent.toLowerCase();
            if (regionName.includes(searchTerm)) {
                card.style.display = 'block';
                hasResults = true;
            } else {
                card.style.display = 'none';
            }
        });

        // Handle no results
        let noResultsMsg = document.getElementById('no-results-msg');
        if (!hasResults) {
            if (!noResultsMsg) {
                noResultsMsg = document.createElement('div');
                noResultsMsg.id = 'no-results-msg';
                noResultsMsg.className = 'loading-state';
                noResultsMsg.innerHTML = '<p>No regions found matching your search.</p>';
                document.getElementById('regions-container').appendChild(noResultsMsg);
            }
        } else if (noResultsMsg) {
            noResultsMsg.remove();
        }
    });
}

function updateStats(lastUpdated, regionCount, totalCidrs) {
    const statsContainer = document.getElementById('stats-summary');
    const date = new Date(lastUpdated).toLocaleString();

    statsContainer.innerHTML = `
        <div class="stat-item">
            <span class="stat-value">${regionCount}</span>
            <span class="stat-label">Regions</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${totalCidrs}</span>
            <span class="stat-label">Total CIDRs</span>
        </div>
        <div class="stat-item" style="display: none;">
            <span class="stat-label">Updated: ${date}</span>
        </div>
    `;
}

function createRegionCard(region, index) {
    const card = document.createElement('div');
    card.className = 'region-card';
    card.style.animationDelay = `${Math.min(index * 0.05, 0.5)}s`;

    // Content for the table
    const tableRows = region.cidrs.map(c => `
        <tr>
            <td>${c.range.first}</td>
            <td>${c.range.last}</td>
            <td style="color: var(--text-secondary);">${c.cidr}</td>
            <td style="font-family: var(--font-mono); color: var(--success-color);">${c.ipCount.toLocaleString()}</td>
        </tr>
    `).join('');

    card.innerHTML = `
        <div class="region-header" onclick="toggleCard(this)">
            <div class="region-title">
                <span class="region-name">${region.name}</span>
                <span class="region-count-badge">${region.count} ranges</span>
                <span class="region-count-badge" style="background-color: rgba(74, 222, 128, 0.1); color: var(--success-color); border-color: rgba(74, 222, 128, 0.2);">${region.totalIps.toLocaleString()} IPs</span>
            </div>
            <svg class="toggle-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        </div>
        <div class="region-content">
            <div class="ip-table-wrapper">
                <table class="ip-table">
                    <thead>
                        <tr>
                            <th>First IP</th>
                            <th>Last IP</th>
                            <th>CIDR Block</th>
                            <th>IP Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return card;
}

window.toggleCard = function (headerElement) {
    const card = headerElement.parentElement;
    card.classList.toggle('expanded');
};

/**
 * Helper: CIDR to IP Range
 */
function cidrToRange(cidr) {
    const [ip, maskStr] = cidr.split('/');
    const mask = parseInt(maskStr, 10);

    const ipLong = ipToLong(ip);
    const totalHosts = Math.pow(2, 32 - mask);

    // Network Address (First IP)
    const networkLong = (ipLong & ((-1 << (32 - mask)))) >>> 0;

    // Broadcast Address (Last IP)
    const broadcastLong = (networkLong + totalHosts - 1) >>> 0;

    return {
        first: longToIp(networkLong),
        last: longToIp(broadcastLong),
        count: totalHosts
    };
}

function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => {
        return ((acc << 8) + parseInt(octet, 10)) >>> 0;
    }, 0);
}

function longToIp(long) {
    return [
        (long >>> 24) & 255,
        (long >>> 16) & 255,
        (long >>> 8) & 255,
        long & 255
    ].join('.');
}
