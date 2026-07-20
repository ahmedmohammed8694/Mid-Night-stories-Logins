import os
import zipfile
import xml.etree.ElementTree as ET
import uuid
import shutil
import sqlite3
import re

# Paths
SOURCE_DIR = r"C:\Users\Mohammed Ahmed\Downloads\J.K. Rowling"
TARGET_UPLOADS_DIR = r"d:\My Applications\Midnigth stories\public\uploads"
DB_PATH = r"d:\My Applications\Midnigth stories\data\stories.db"

# Ensure target uploads directory exists
os.makedirs(TARGET_UPLOADS_DIR, exist_ok=True)

def clean_html(text):
    if not text:
        return ""
    # Strip HTML tags
    clean = re.compile('<.*?>')
    return re.sub(clean, '', text).strip()

def extract_epub_metadata(epub_path):
    try:
        with zipfile.ZipFile(epub_path) as z:
            # Find container.xml
            container_xml = z.read("META-INF/container.xml")
            root = ET.fromstring(container_xml)
            opf_path = root.find(".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile").attrib["full-path"]
            
            # Read OPF XML
            opf_xml = z.read(opf_path)
            opf_root = ET.fromstring(opf_xml)
            
            ns = {
                'opf': 'http://www.idpf.org/2007/opf',
                'dc': 'http://purl.org/dc/elements/1.1/'
            }
            
            title = opf_root.find(".//dc:title", ns)
            creator = opf_root.find(".//dc:creator", ns)
            description = opf_root.find(".//dc:description", ns)
            
            title_text = title.text if title is not None else None
            creator_text = creator.text if creator is not None else None
            desc_text = clean_html(description.text) if description is not None else ""
            
            # Find cover image in manifest
            cover_id = None
            for meta in opf_root.findall(".//opf:metadata/opf:meta", ns):
                if meta.attrib.get("name") == "cover":
                    cover_id = meta.attrib.get("content")
                    
            cover_href = None
            for item in opf_root.findall(".//opf:manifest/opf:item", ns):
                if cover_id and item.attrib.get("id") == cover_id:
                    cover_href = item.attrib.get("href")
                    break
                if "cover-image" in item.attrib.get("properties", ""):
                    cover_href = item.attrib.get("href")
                    break
                if "cover" in item.attrib.get("id", "").lower() and item.attrib.get("media-type", "").startswith("image/"):
                    cover_href = item.attrib.get("href")
            
            cover_data = None
            if cover_href:
                opf_dir = os.path.dirname(opf_path)
                cover_full_path = f"{opf_dir}/{cover_href}" if opf_dir else cover_href
                try:
                    cover_data = z.read(cover_full_path)
                except Exception:
                    try:
                        normalized_path = cover_href.replace("../", "")
                        for name in z.namelist():
                            if name.endswith(normalized_path):
                                cover_data = z.read(name)
                                break
                    except Exception:
                        pass
                        
            return title_text, creator_text, desc_text, cover_data
    except Exception as e:
        filename = os.path.basename(epub_path)
        name, _ = os.path.splitext(filename)
        parts = name.split(" - ")
        if len(parts) >= 2:
            return parts[0], parts[1], "", None
        return name, "J.K. Rowling", "", None

def main():
    print("🚀 Starting upload of J.K. Rowling's books...")
    
    # 1. Connect to Database and get Fiction category ID
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT id FROM categories WHERE slug = 'fiction'")
    cat_row = cursor.fetchone()
    category_id = cat_row[0] if cat_row else 1
    print(f"📌 Mapping books to Category ID: {category_id}")
    
    # Find all epub/pdf files
    book_files = []
    for root, dirs, files in os.walk(SOURCE_DIR):
        for f in files:
            if f.lower().endswith(('.epub', '.pdf')):
                book_files.append(os.path.join(root, f))
                
    total_books = len(book_files)
    print(f"📚 Found {total_books} books to upload.")
    
    success_count = 0
    for idx, epub_path in enumerate(book_files, 1):
        try:
            filename = os.path.basename(epub_path)
            ext = os.path.splitext(filename)[1].lower().replace(".", "")
            
            # Extract metadata
            if ext == "epub":
                title, author, description, cover_data = extract_epub_metadata(epub_path)
            else:
                name, _ = os.path.splitext(filename)
                parts = name.split(" - ")
                title = parts[0] if len(parts) > 0 else name
                author = parts[1] if len(parts) > 1 else "J.K. Rowling"
                description = f"Book by {author}."
                cover_data = None
                
            if not title:
                title = os.path.splitext(filename)[0]
            if not author:
                author = "J.K. Rowling"
                
            # Clean author representation
            author = author.replace(" & Mary Grandpre", "").replace("_", " ")
            
            # Generate UUID for filenames
            file_uuid = str(uuid.uuid4())
            new_book_filename = f"{file_uuid}.{ext}"
            new_book_path = os.path.join(TARGET_UPLOADS_DIR, new_book_filename)
            
            # Copy book file
            shutil.copy2(epub_path, new_book_path)
            
            # Save cover image if exists
            new_cover_filename = None
            if cover_data:
                new_cover_filename = f"{file_uuid}.jpg"
                new_cover_path = os.path.join(TARGET_UPLOADS_DIR, new_cover_filename)
                with open(new_cover_path, "wb") as f_cover:
                    f_cover.write(cover_data)
            
            file_url = f"/uploads/{new_book_filename}"
            cover_url = f"/uploads/{new_cover_filename}" if new_cover_filename else "/uploads/default_cover.png"
            
            cursor.execute("""
                INSERT INTO books (title, author, description, file_url, cover_image_url, file_type, status, visibility, channel_type, is_user_submission, submission_status)
                VALUES (?, ?, ?, ?, ?, ?, 'published', 'public', 'education', 0, 'approved')
            """, (title, author, description, file_url, cover_url, ext, ))
            
            book_id = cursor.lastrowid
            
            # Map category
            cursor.execute("""
                INSERT OR IGNORE INTO book_categories (book_id, category_id)
                VALUES (?, ?)
            """, (book_id, category_id))
            
            success_count += 1
            print(f"  [Success] Uploaded '{title}' by {author}")
                
        except Exception as e:
            print(f"  ❌ Error uploading '{os.path.basename(epub_path)}': {e}")
            
    conn.commit()
    conn.close()
    print(f"🎉 Successfully uploaded {success_count} out of {total_books} J.K. Rowling books.")

if __name__ == "__main__":
    main()
