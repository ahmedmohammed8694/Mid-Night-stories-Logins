import os
import sqlite3
import subprocess
import concurrent.futures
import sys

# Paths
DB_PATH = r"d:\My Applications\Midnigth stories\data\stories.db"
UPLOADS_DIR = r"d:\My Applications\Midnigth stories\public\uploads"
BUCKET_NAME = "midnight-stories-images"

def upload_file(filename):
    file_path = os.path.join(UPLOADS_DIR, filename)
    if not os.path.exists(file_path):
        return filename, False, "File does not exist locally"
        
    cmd = [
        "npx", "wrangler", "r2", "object", "put",
        f"{BUCKET_NAME}/{filename}",
        f"--file={file_path}",
        "--remote"
    ]
    try:
        # Run wrangler upload command
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", shell=True, cwd=r"C:\Users\Mohammed Ahmed", stdin=subprocess.DEVNULL)
        if res.returncode == 0:
            return filename, True, "Success"
        else:
            return filename, False, res.stderr.strip()
    except Exception as e:
        return filename, False, str(e)

def main():
    print("🚀 Starting sync of book files and covers to Cloudflare R2...")
    
    # 1. Read files from database
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT file_url, cover_image_url
        FROM books
        WHERE author != 'Developer Antigravity'
    """)
    rows = cursor.fetchall()
    conn.close()
    
    # Collect unique filenames to upload
    filenames = set()
    for row in rows:
        file_url, cover_url = row
        if file_url:
            filenames.add(os.path.basename(file_url))
        if cover_url and "default_cover.png" not in cover_url:
            filenames.add(os.path.basename(cover_url))
            
    files_to_upload = sorted(list(filenames))
    total_files = len(files_to_upload)
    print(f"📦 Found {total_files} files (EPUB/PDF and covers) to upload to R2.")
    
    # 2. Upload in parallel
    print("⏳ Uploading files in parallel threads...")
    success_count = 0
    fail_count = 0
    
    # Use ThreadPoolExecutor for concurrent uploads
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        future_to_file = {executor.submit(upload_file, fname): fname for fname in files_to_upload}
        for idx, future in enumerate(concurrent.futures.as_completed(future_to_file), 1):
            fname = future_to_file[future]
            try:
                fname, success, msg = future.result()
                if success:
                    success_count += 1
                else:
                    fail_count += 1
                    print(f"  ❌ Failed upload for '{fname}': {msg}")
            except Exception as exc:
                fail_count += 1
                print(f"  ❌ Upload generated an exception for '{fname}': {exc}")
                
            if idx % 20 == 0 or idx == total_files:
                print(f"  [Progress] {idx}/{total_files} files processed. (Success: {success_count}, Fail: {fail_count})")
                sys.stdout.flush()
                
    print(f"🎉 R2 sync complete! Successfully uploaded {success_count} files ({fail_count} failed) to Cloudflare R2 bucket '{BUCKET_NAME}'.")

if __name__ == "__main__":
    main()
