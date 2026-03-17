const https = require('https');

const token =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiODJmNTc1ZTMzNmIyZDQwZjRjYTVmOTcxNTZkNTA0NGFhYWQ0NDQ5ZDhlYTY5ZTFhMWQ5MTQ4YjEyZmNiNzZiOWZmOWMyMGFkMWFmZTU5NmUiLCJpYXQiOjE3NzI0NTU2NzQuMTc5NzQ4LCJuYmYiOjE3NzI0NTU2NzQuMTc5NzUxLCJleHAiOjE3NzUwNDc2NzQuMTcxNzAzLCJzdWIiOiI0OTgyNjY2Iiwic2NvcGVzIjpbXSwidGVhbV9pZCI6NDg4MTU3NSwidGVhbV9wbGFuIjoiZnJlZSIsInRlYW1fcGxhbl9leHBpcmF0aW9uIjoxNzcyMzU2Mjg4fQ.HETW9VI7feE7OM3_Mi6X3oyuTuBchVaAwnJEUtyD8OQMViWB_l6dDyDEqGGmMM2sYHgdjzKKuVqfqTCu8W-acVrKJoCqoqcAhi5igjJk8uFhSis--m6Zrix8gFZpkPz20Bylujcrh5FhfCje0rNuJ2B72yvY52b3vbgD5O2FoU3iy7hSXVlWFGOQI1EyAeRPQQmW31f_Qg3CnWP7JsGw0AZxOoB7B0haDbDVS9b8SV-OOIlARyUupmxbvEi77s7iLc95_ytfLpIgKrh0LQZrkwFxB-so6AIc02fjuY_2bJYU0F0XMLkxy5FYwIJBKEre1lbCPQpsoj4nnAABx-qdqPHMZVOje5XGUR4YhvAI6vbB5QCugMuIEafrvW5Mb0CTyMCzjxkRlOpRHj3sXHx7vFP5wgxAf0nK0XS8y98IT5GCK5voJlhWxjb3ongivGzi0OB38sJlVVrz3EB-dJe17VuzVo8mP1RsH7GnT17mfEL7PxsjEbeajfJQgFjzG1tqYTv6FlgIXdPKF25Qg6rh2MotNUf9ktd2JmRXLryThrRyaRrf2ipUA3Zq6mHYLOYXC-JsCbDdHGX7Z3Ajpe5EqTjhIJX8GdaYHg32WGZQm_ce4m1NRJmtL8qx-mEG2gYWbHrDsKoD3NSgz0ttqNuU483PyE4FyssveE2eXvjL4sg';

function fetchProfiles() {
  const options = {
    hostname: 'anty-api.com',
    path: '/browser_profiles?limit=50',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      if (res.statusCode === 200) {
        try {
          const json = JSON.parse(data);
          console.log(JSON.stringify(json, null, 2));
        } catch (e) {
          console.error('Failed to parse JSON:', e.message);
        }
      } else {
        console.error(`API Error: ${res.statusCode}`, data);
      }
    });
  });

  req.on('error', (e) => {
    console.error(`Request Error: ${e.message}`);
  });

  req.end();
}

fetchProfiles();
