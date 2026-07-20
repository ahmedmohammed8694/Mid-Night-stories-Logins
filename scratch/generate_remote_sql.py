import sqlite3

DB_PATH = r"d:\My Applications\Midnigth stories\data\stories.db"
OUTPUT_SQL = r"d:\My Applications\Midnigth stories\scratch\remote_books.sql"

def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Fetch all books that were uploaded (not from the test suite)
    cursor.execute("""
        SELECT id, title, author, description, file_url, cover_image_url, file_type, status, visibility, channel_type, is_user_submission, submission_status
        FROM books
        WHERE author != 'Developer Antigravity'
    """)
    books = cursor.fetchall()
    
    sql_lines = []
    sql_lines.append("-- SQL Script to insert uploaded books into remote Cloudflare D1")
    sql_lines.append("PRAGMA foreign_keys = ON;\n")
    
    # We want to map category_id too
    for b in books:
        b_id, title, author, description, file_url, cover_image_url, file_type, status, visibility, channel_type, is_user_submission, submission_status = b
        
        # Escape single quotes in strings
        title_esc = title.replace("'", "''")
        author_esc = author.replace("'", "''")
        desc_esc = description.replace("'", "''") if description else ""
        
        # Generate INSERT statement for the book. We use INSERT OR IGNORE and let D1 handle the auto-increment id,
        # but to keep IDs aligned with the uploads folder, we insert the specific ID.
        sql_lines.append(
            f"INSERT OR IGNORE INTO books (id, title, author, description, file_url, cover_image_url, file_type, status, visibility, channel_type, is_user_submission, submission_status) "
            f"VALUES ({b_id}, '{title_esc}', '{author_esc}', '{desc_esc}', '{file_url}', '{cover_image_url}', '{file_type}', '{status}', '{visibility}', '{channel_type}', {is_user_submission}, '{submission_status}');"
        )
        
        # Get category mappings for this book
        cursor.execute("SELECT category_id FROM book_categories WHERE book_id = ?", (b_id,))
        cats = cursor.fetchall()
        for cat in cats:
            sql_lines.append(
                f"INSERT OR IGNORE INTO book_categories (book_id, category_id) VALUES ({b_id}, {cat[0]});"
            )
            
    conn.close()
    
    with open(OUTPUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(sql_lines))
        
    print(f"🎉 Generated SQL script with {len(books)} book inserts at {OUTPUT_SQL}")

if __name__ == "__main__":
    main()
