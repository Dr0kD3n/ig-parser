const { createBrowserContext } = require('../backend/lib/browser');
const { humanMove, humanClick, wait } = require('../backend/lib/utils');
const path = require('path');
const fs = require('fs');

async function testMouseMovement() {
    console.log('🧪 Starting mouse movement test...');

    // Simple HTML to visualize movement
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Mouse Path Tracker</title>
        <style>
            body { margin: 0; overflow: hidden; background: #1a1a1a; color: white; font-family: sans-serif; }
            canvas { display: block; }
            #target { 
                position: absolute; 
                width: 100px; 
                height: 50px; 
                background: #4CAF50; 
                border-radius: 8px; 
                display: flex; 
                align-items: center; 
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            }
        </style>
    </head>
    <body>
        <div id="target" style="left: 600px; top: 400px;">CLICK ME</div>
        <canvas id="canvas"></canvas>
        <script>
            const canvas = document.getElementById('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            window.addEventListener('mousemove', (e) => {
                ctx.lineTo(e.clientX, e.clientY);
                ctx.stroke();
                
                // Draw a small dot
                ctx.fillStyle = 'cyan';
                ctx.fillRect(e.clientX - 1, e.clientY - 1, 2, 2);
            });
            
            document.getElementById('target').onclick = () => {
                document.getElementById('target').style.background = '#ff4081';
                document.getElementById('target').innerText = 'CLICKED!';
            };
        </script>
    </body>
    </html>
    `;

    const tempHtml = path.join(__dirname, 'mouse_test.html');
    fs.writeFileSync(tempHtml, htmlContent);

    const { browser, context } = await createBrowserContext({ id: 'test_mouse' }, false); // Headful to see
    const page = await context.newPage();

    try {
        await page.goto('file://' + tempHtml);
        await wait(1000);

        console.log('🖱️ Moving to (600, 400)...');
        await humanMove(page, 650, 425, { startX: 100, startY: 100 });

        await wait(1000);

        console.log('🖱️ Clicking the target...');
        await humanClick(page, '#target');

        await wait(2000);

        const screenshotPath = path.join(__dirname, 'mouse_movement_result.png');
        await page.screenshot({ path: screenshotPath });
        console.log('✅ Test screenshot saved to:', screenshotPath);

    } catch (e) {
        console.error('❌ Test failed:', e);
    } finally {
        await browser.close();
        if (fs.existsSync(tempHtml)) fs.unlinkSync(tempHtml);
    }
}

testMouseMovement();
