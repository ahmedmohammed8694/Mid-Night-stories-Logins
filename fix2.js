const fs = require('fs');
const files = [
  'D:/My Applications/Midnigth stories/src/worker.js',
  'D:/My Applications/Midnigth stories/admin/src/worker.js'
];
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/\\\SELECT target_type/g, "\\n    SELECT target_type");
  content = content.replace(/ORDER BY incident_count DESC\\\/g, "ORDER BY incident_count DESC\n  \");
  fs.writeFileSync(file, content);
}
