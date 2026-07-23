const { execFile } = require('child_process');

console.log("Executing build_updated_seo_excel.py via node execFile...");
const child = execFile('python', ['build_updated_seo_excel.py'], { stdio: ['pipe', 'pipe', 'pipe'] }, (error, stdout, stderr) => {
  if (error) {
    console.error("Exec error:", error);
    return;
  }
  console.log("Stdout:", stdout);
  console.log("Stderr:", stderr);
});
