document.getElementById('vlsmForm').addEventListener('submit', function (e) {
    e.preventDefault();
    calculateVLSM();
});

function parseCIDR(subnet) {
    const [ip, prefix] = subnet.split('/');
    if (!ip || !prefix) throw new Error('Invalid CIDR format');

    const prefixLength = parseInt(prefix);
    if (isNaN(prefixLength) || prefixLength < 0 || prefixLength > 32) {
        throw new Error('Invalid prefix length');
    }

    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some(o => isNaN(o) || o < 0 || o > 255)) {
        throw new Error('Invalid IP address');
    }

    return { ip: octets, prefixLength };
}

function calculateNetworkAddress(ip, prefixLength) {
    const mask = ~(0xffffffff >>> prefixLength) >>> 0;
    const ipInt = (ip[0] << 24) + (ip[1] << 16) + (ip[2] << 8) + ip[3];
    const networkInt = ipInt & mask;
    return [
        (networkInt >>> 24) & 255,
        (networkInt >>> 16) & 255,
        (networkInt >>> 8) & 255,
        networkInt & 255
    ];
}

function calculateBroadcastAddress(ip, prefixLength) {
    const mask = ~(0xffffffff >>> prefixLength) >>> 0;
    const ipInt = (ip[0] << 24) + (ip[1] << 16) + (ip[2] << 8) + ip[3];
    const broadcastInt = ipInt | ~mask;
    return [
        (broadcastInt >>> 24) & 255,
        (broadcastInt >>> 16) & 255,
        (broadcastInt >>> 8) & 255,
        broadcastInt & 255
    ];
}

function usableRange(ip, prefixLength) {
    const network = calculateNetworkAddress(ip, prefixLength);
    const broadcast = calculateBroadcastAddress(ip, prefixLength);

    const networkInt = (network[0] << 24) + (network[1] << 16) + (network[2] << 8) + network[3];
    const broadcastInt = (broadcast[0] << 24) + (broadcast[1] << 16) + (broadcast[2] << 8) + broadcast[3];

    if (prefixLength >= 31) {
        if (prefixLength === 31) {
            // /31: Exactly 2 addresses (point-to-point)
            return [network.join('.'), broadcast.join('.')];
        } else {
            // /32: No usable hosts
            return [null, null];
        }
    }

    // First usable host: network + 1
    const firstHostInt = networkInt + 1;
    const firstHost = [
        (firstHostInt >>> 24) & 255,
        (firstHostInt >>> 16) & 255,
        (firstHostInt >>> 8) & 255,
        firstHostInt & 255
    ];

    // Last usable host: broadcast - 1
    const lastHostInt = broadcastInt - 1;
    const lastHost = [
        (lastHostInt >>> 24) & 255,
        (lastHostInt >>> 16) & 255,
        (lastHostInt >>> 8) & 255,
        lastHostInt & 255
    ];

    return [firstHost.join('.'), lastHost.join('.')];
}

function getRequiredPrefixLength(hosts) {
    // Add 2 for network and broadcast addresses
    const totalAddresses = hosts + 2;
    // Find the smallest power of 2 that can accommodate the total addresses
    let prefixLength = 32;
    while (prefixLength > 0) {
        const subnetSize = Math.pow(2, 32 - prefixLength);
        if (subnetSize >= totalAddresses) break;
        prefixLength--;
    }
    return prefixLength;
}

function ipToInt(ip) {
    return (ip[0] << 24) + (ip[1] << 16) + (ip[2] << 8) + ip[3];
}

function intToIp(int) {
    return [
        (int >>> 24) & 255,
        (int >>> 16) & 255,
        (int >>> 8) & 255,
        int & 255
    ];
}

function calculateVLSM() {
    const baseIpInput = document.getElementById('baseIpInput').value.trim();
    const hostRequirementsInput = document.getElementById('hostRequirements').value.trim();
    const resultsDiv = document.getElementById('results');
    const subnetListDiv = document.getElementById('subnetList');
    const errorDiv = document.getElementById('error');

    // Reset previous results
    resultsDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
    subnetListDiv.innerHTML = '';
    errorDiv.textContent = '';

    try {
        // Parse base IP and prefix
        const { ip, prefixLength } = parseCIDR(baseIpInput);

        // Parse host requirements
        const hostRequirements = hostRequirementsInput.split(',').map(Number);
        if (hostRequirements.some(isNaN)) {
            throw new Error('Invalid host requirements. Please enter comma-separated numbers.');
        }

        // Calculate required subnets
        const subnets = hostRequirements.map(hosts => ({
            hosts,
            prefixLength: getRequiredPrefixLength(hosts),
            subnetSize: Math.pow(2, 32 - getRequiredPrefixLength(hosts))
        }));

        // Sort subnets by size (largest first)
        subnets.sort((a, b) => b.subnetSize - a.subnetSize);

        // Calculate total addresses needed
        const totalAddressesNeeded = subnets.reduce((sum, subnet) => sum + subnet.subnetSize, 0);
        const availableAddresses = Math.pow(2, 32 - prefixLength);
        if (totalAddressesNeeded > availableAddresses) {
            throw new Error('Not enough addresses available for the given requirements.');
        }

        // Allocate subnets
        let currentIp = ipToInt(ip);
        const subnetDetails = subnets.map((subnet, index) => {
            const network = intToIp(currentIp);
            const prefixLength = subnet.prefixLength;
            const broadcast = calculateBroadcastAddress(network, prefixLength);
            const [firstHost, lastHost] = usableRange(network, prefixLength);

            const details = {
                name: `Subnet ${index + 1} (${subnet.hosts} hosts)`,
                network: `${network.join('.')}/${prefixLength}`,
                broadcast: broadcast.join('.'),
                hostRange: firstHost && lastHost ? `${firstHost} - ${lastHost}` : 'No usable hosts',
                subnetMask: prefixLengthToSubnetMask(prefixLength)
            };

            // Move to the next subnet
            currentIp += subnet.subnetSize;
            return details;
        });

        // Display results
        subnetDetails.forEach(detail => {
            const subnetDiv = document.createElement('div');
            subnetDiv.className = 'subnet-item';
            subnetDiv.innerHTML = `
                <h3>${detail.name}</h3>
                <p><strong>Network:</strong> ${detail.network}</p>
                <p><strong>Broadcast:</strong> ${detail.broadcast}</p>
                <p><strong>Usable Host Range:</strong> ${detail.hostRange}</p>
                <p><strong>Subnet Mask:</strong> ${detail.subnetMask}</p>
            `;
            subnetListDiv.appendChild(subnetDiv);
        });

        resultsDiv.classList.remove('hidden');
    } catch (err) {
        errorDiv.textContent = `❌ ${err.message || 'An error occurred while calculating subnets.'}`;
        errorDiv.classList.remove('hidden');
    }
}

function prefixLengthToSubnetMask(prefixLength) {
    const mask = ~(0xffffffff >>> prefixLength) >>> 0;
    return [
        (mask >>> 24) & 255,
        (mask >>> 16) & 255,
        (mask >>> 8) & 255,
        mask & 255
    ].join('.');
}