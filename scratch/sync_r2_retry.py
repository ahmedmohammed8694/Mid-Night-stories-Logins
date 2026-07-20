import os
import sqlite3
import subprocess
import json
import time
import sys

# Paths
DB_PATH = r"d:\My Applications\Midnigth stories\data\stories.db"
UPLOADS_DIR = r"d:\My Applications\Midnigth stories\public\uploads"
BUCKET_NAME = "midnight-stories-images"

def get_remote_files():
    print("🔍 Fetching list of existing files in remote R2 bucket...")
    cmd = [
        "npx", "wrangler", "r2", "object", "list",
        BUCKET_NAME,
        "--limit", "1000"
    ]
    try:
        # Run wrangler list command
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", shell=True, cwd=r"C:\Users\Mohammed Ahmed", stdin=subprocess.DEVNULL)
        if res.returncode == 0:
            # Parse output
            try:
                data = json.loads(res.stdout)
                # D1/R2 list returns a list of objects with a 'key' property
                return {obj["key"] for obj in data}
            except Exception:
                # If wrangler output was text-formatted instead of json, parse keys manually
                keys = set()
                for line in res.stdout.splitlines():
                    parts = line.strip().split()
                    if parts and parts[0] != "Key" and not parts[0].startswith("---"):
                        keys.add(parts[0])
                return keys
        else:
            print("  ⚠️ Could not fetch list via Wrangler JSON. Defaulting to empty sync.")
            return set()
    except Exception as e:
        print("  ⚠️ Error fetching remote list:", e)
        return set()

def upload_file_with_retry(filename, max_retries=3):
    file_path = os.path.join(UPLOADS_DIR, filename)
    if not os.path.exists(file_path):
        return False, "Local file not found"
        
    cmd = [
        "npx", "wrangler", "r2", "object", "put",
        f"{BUCKET_NAME}/{filename}",
        f"--file={file_path}",
        "--remote"
    ]
    
    for attempt in range(1, max_retries + 1):
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", shell=True, cwd=r"C:\Users\Mohammed Ahmed", stdin=subprocess.DEVNULL)
            if res.returncode == 0:
                return True, "Success"
            else:
                err_msg = res.stderr.strip() or res.stdout.strip()
                print(f"  ⚠️ Attempt {attempt}/{max_retries} failed for '{filename}': {err_msg}")
        except Exception as e:
            print(f"  ⚠️ Attempt {attempt}/{max_retries} exception for '{filename}': {e}")
            
        if attempt < max_retries:
            time.sleep(2) # Backoff delay before retry
            
    return False, "Failed after max retries"

def main():
    print("🚀 Starting self-healing R2 sync...")
    
    # 1. Fetch files registered in the database
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT file_url, cover_image_url
        FROM books
        WHERE author != 'Developer Antigravity'
    """)
    rows = cursor.fetchall()
    conn.close()
    
    # Collect unique filenames
    db_filenames = set()
    for row in rows:
        file_url, cover_url = row
        if file_url:
            db_filenames.add(os.path.basename(file_url))
        if cover_url and "default_cover.png" not in cover_url:
            db_filenames.add(os.path.basename(cover_url))
            
    total_db_files = len(db_filenames)
    print(f"📚 Database has {total_db_files} unique files.")
    
    # 2. Get list of files already in R2
    remote_keys = get_remote_files()
    print(f"☁️ Remote R2 bucket has {len(remote_keys)} files.")
    
    # 3. Find files missing from R2
    missing_files = sorted(list(db_filenames - remote_keys))
    total_missing = len(missing_files)
    
    if total_missing == 0:
        print("🎉 R2 Sync Complete! All files are already present on Cloudflare.")
        return
        
    print(f"📦 Found {total_missing} files missing or failed in the previous runs.")
    print("⏳ Starting sequential uploads with auto-retry to prevent rate limits and locks...")
    sys.stdout.flush()
    
    success_count = 0
    fail_count = 0
    
    for idx, fname in enumerate(missing_files, 1):
        print(f"  [{idx}/{total_missing}] Uploading '{fname}'...")
        sys.stdout.flush()
        
        success, msg = upload_file_with_retry(fname)
        if success:
            success_count += 1
        else:
            fail_count += 1
            print(f"  ❌ Failed final upload for '{fname}': {msg}")
            sys.stdout.flush()
            
    print(f"🎉 Sync Complete! Successfully uploaded {success_count} missing files to R2. (Failed: {fail_count})")

if __name__ == "__main__":
    main()
