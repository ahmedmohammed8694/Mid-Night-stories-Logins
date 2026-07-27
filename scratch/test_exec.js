const { execSync } = require('child_process');
try {
  const out = execSync('npx wrangler d1 execute midnight-stories-login-db --remote --command="SELECT COUNT(*) as total FROM books"', { encoding: 'utf-8' });
  console.log('OUTPUT:\n', out);
} catch (err) {
  console.error('ERROR:\n', err.stdout || err.message);
}
