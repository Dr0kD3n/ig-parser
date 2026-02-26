const { spawn, exec } = require('child_process');
const path = require('path');

async function testKill() {
    console.log('Starting long-running process (ping)...');
    // Use ping -t as a long-running process on Windows
    const child = spawn('ping', ['-t', 'localhost'], { shell: true });
    const pid = child.pid;
    console.log(`Process started with PID: ${pid}`);

    // Wait 2 seconds
    await new Promise(r => setTimeout(r, 2000));

    console.log(`Attempting to kill process tree for PID: ${pid} using taskkill...`);

    return new Promise((resolve, reject) => {
        exec(`taskkill /F /T /PID ${pid}`, (err, stdout, stderr) => {
            if (err) {
                console.error('Taskkill failed:', err);
                console.error('Stderr:', stderr);
                child.kill(); // fallback
                reject(err);
            } else {
                console.log('Taskkill output:', stdout);
                console.log('Verifying if process is still alive...');

                // Try to check if PID exists after 1 second
                setTimeout(() => {
                    exec(`tasklist /FI "PID eq ${pid}"`, (err, stdout) => {
                        if (stdout.includes(pid.toString())) {
                            console.error('❌ Process STILL ALIVE!');
                            resolve(false);
                        } else {
                            console.log('✅ Process tree terminated successfully.');
                            resolve(true);
                        }
                    });
                }, 1000);
            }
        });
    });
}

testKill().then(success => {
    process.exit(success ? 0 : 1);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
