const { execSync } = require('child_process');

const ports = [5000, 5001, 5173, 5174];

console.log(`🧹 Cleaning up ports: ${ports.join(', ')}`);

ports.forEach(port => {
    try {
        const cmd = `netstat -ano | findstr :${port}`;
        const output = execSync(cmd).toString();
        const lines = output.split('\n').filter(Boolean);

        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && pid !== '0') {
                console.log(`Killing process ${pid} on port ${port}...`);
                try {
                    execSync(`taskkill /F /PID ${pid}`);
                } catch (e) { }
            }
        });
    } catch (e) {
        // Port not in use
    }
});
