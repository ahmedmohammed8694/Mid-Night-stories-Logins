const fs = require('fs');
const files = [
  'D:/My Applications/Midnigth stories/src/worker.js',
  'D:/My Applications/Midnigth stories/admin/src/worker.js'
];
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/(\(\s*)SELECT target_type/, "`\n    SELECT target_type");
  content = content.replace(/ORDER BY incident_count DESC(\s*\))\.all\(\);/, "ORDER BY incident_count DESC\n  `.all();");
  fs.writeFileSync(file, content);
}
